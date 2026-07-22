/**
 * WhatsApp Accounts Manager
 * Uses @whiskeysockets/baileys for WebSocket-based WA communication
 */
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidUser
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import pino from 'pino';

import { getDb } from '../../db/database.js';
import { io } from '../../server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(__dirname, '../../../backend/sessions');

const activeSockets = new Map();
const logger = pino({ level: 'silent' });

export function sleep(minMs, maxMs) {
  const mean = (minMs + maxMs) / 2;
  const std = (maxMs - minMs) / 6;
  const u1 = Math.random(), u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const delay = Math.max(minMs, Math.min(maxMs, mean + z * std));
  return new Promise(resolve => setTimeout(resolve, delay));
}

export async function connectAccount(accountId) {
  const db = getDb();
  const sessionDir = join(SESSIONS_DIR, accountId);
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

  await db`UPDATE accounts SET status = 'connecting' WHERE id = ${accountId}`;
  io.emit('account:status', { id: accountId, status: 'connecting' });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    printQRInTerminal: false,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: false
  });

  activeSockets.set(accountId, sock);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const qrBase64 = await qrcode.toDataURL(qr);
      io.emit('account:qr', { id: accountId, qr: qrBase64 });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
        : true;
      const isBanned = lastDisconnect?.error?.output?.statusCode === 401;

      await db`UPDATE accounts SET status = ${isBanned ? 'banned' : 'offline'}, last_seen = NOW() WHERE id = ${accountId}`;
      io.emit('account:status', { id: accountId, status: isBanned ? 'banned' : 'offline' });
      activeSockets.delete(accountId);

      if (shouldReconnect && !isBanned) {
        console.log(`[Accounts] Reconnecting ${accountId} in 5s...`);
        setTimeout(() => connectAccount(accountId), 5000);
      }
    }

    if (connection === 'open') {
      try {
        const info = sock.user;
        const phone = info?.id?.split(':')[0] || '';
        const name = info?.name || '';
        await db`UPDATE accounts SET status = 'online', phone = ${phone}, name = ${name}, last_seen = NOW() WHERE id = ${accountId}`;
        io.emit('account:status', { id: accountId, status: 'online', phone, name });
      } catch {
        await db`UPDATE accounts SET status = 'online' WHERE id = ${accountId}`;
        io.emit('account:status', { id: accountId, status: 'online' });
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!isJidUser(msg.key.remoteJid)) continue;

      const phone = msg.key.remoteJid.split('@')[0].replace(/\D/g, '');
      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || '[media]';

      const leads = await db`SELECT * FROM leads WHERE phone LIKE ${'%' + phone.slice(-9)}`;
      const lead = leads[0];
      if (lead) {
        await db`
          INSERT INTO messages (lead_id, account_id, direction, content, status, wa_message_id)
          VALUES (${lead.id}, ${accountId}, 'in', ${text}, 'read', ${msg.key.id})
        `;

        if (lead.status === 'sent') {
          await db`UPDATE leads SET status = 'replied', last_contact_at = NOW() WHERE id = ${lead.id}`;
        }

        io.emit('lead:replied', {
          leadId: lead.id,
          phone: lead.phone,
          name: lead.name,
          message: text,
          accountId
        });
      }
    }
  });

  return sock;
}

export async function disconnectAccount(accountId) {
  const sock = activeSockets.get(accountId);
  if (sock) {
    try { await sock.logout(); } catch { /* ignore */ }
    activeSockets.delete(accountId);
  }
}

export async function sendMessage(accountId, phone, text) {
  const sock = activeSockets.get(accountId);
  if (!sock) throw new Error(`Account ${accountId} not connected`);

  const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

  try {
    const [result] = await sock.onWhatsApp(jid);
    if (!result?.exists) throw new Error(`${phone} is not on WhatsApp`);
  } catch (err) {
    if (!err.message.includes('not on WhatsApp')) throw err;
    throw new Error(`${phone} is not on WhatsApp`);
  }

  await sock.sendPresenceUpdate('composing', jid);
  const typingDelay = Math.max(1000, text.length * 30 + Math.random() * 1000);
  await sleep(typingDelay, typingDelay + 500);
  await sock.sendPresenceUpdate('paused', jid);

  const sent = await sock.sendMessage(jid, { text });
  return sent;
}

export async function sendWarmupMessage(fromAccountId, toAccountId, text) {
  const db = getDb();
  const rows = await db`SELECT phone FROM accounts WHERE id = ${toAccountId}`;
  const toAccount = rows[0];
  if (!toAccount?.phone) throw new Error(`Account ${toAccountId} has no phone number`);
  await sendMessage(fromAccountId, toAccount.phone, text);
}

export function getSocket(accountId) {
  return activeSockets.get(accountId);
}

export async function restoreAllAccounts() {
  const db = getDb();
  const accounts = await db`SELECT id FROM accounts WHERE status != 'banned'`;
  console.log(`[Accounts] Restoring ${accounts.length} account(s)...`);
  for (const acc of accounts) {
    try {
      await connectAccount(acc.id);
    } catch (err) {
      console.error(`[Accounts] Failed to restore ${acc.id}:`, err.message);
    }
  }
}
