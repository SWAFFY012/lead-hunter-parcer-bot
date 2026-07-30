import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const sessionPath = join(moduleDir, '../../../../data/telegram/session.txt');

let client = null;
let authPromise = null;
let authState = 'disconnected';
let authError = '';
let account = null;
let pendingCode = null;
let pendingPassword = null;
const entityCache = new Map();

const terminalAuthErrors = [
  'API_ID_INVALID',
  'API_ID_PUBLISHED_FLOOD',
  'PHONE_NUMBER_INVALID',
  'PHONE_NUMBER_BANNED',
];

function errorText(error) {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('API_ID_INVALID')) return 'Неверные API ID или API Hash.';
  if (raw.includes('PHONE_NUMBER_INVALID')) return 'Неверный номер телефона.';
  if (raw.includes('PHONE_NUMBER_BANNED')) return 'Этот номер заблокирован Telegram.';
  if (raw.includes('PHONE_CODE_INVALID')) return 'Неверный код. Введите новый код.';
  if (raw.includes('PHONE_CODE_EXPIRED')) return 'Код истёк. Начните подключение заново.';
  if (raw.includes('PASSWORD_HASH_INVALID')) return 'Неверный пароль двухэтапной аутентификации.';
  if (raw.includes('FLOOD_WAIT')) return 'Telegram временно ограничил запросы. Попробуйте позже.';
  return raw || 'Неизвестная ошибка Telegram.';
}

function accountView(user) {
  if (!user) return null;
  return {
    id: user.id?.toString?.() || String(user.id || ''),
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    username: user.username || '',
    phone: user.phone || '',
  };
}

function publicStatus() {
  return {
    state: authState,
    connected: authState === 'connected',
    error: authError,
    account,
  };
}

function waitForState(timeoutMs = 25_000) {
  const end = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      if (['code_required', 'password_required', 'connected', 'error'].includes(authState) || Date.now() >= end) {
        resolve(publicStatus());
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function loadSession() {
  try {
    return (await readFile(sessionPath, 'utf8')).trim();
  } catch {
    return '';
  }
}

async function saveSession() {
  if (!client) return;
  await mkdir(dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, String(client.session.save()), 'utf8');
}

async function closeClient() {
  pendingCode = null;
  pendingPassword = null;
  entityCache.clear();
  if (client) {
    try {
      await client.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  client = null;
  authPromise = null;
}

export async function connectTelegram({ apiId, apiHash, phone }) {
  const numericApiId = Number(apiId);
  if (!Number.isInteger(numericApiId) || numericApiId <= 0) {
    throw new Error('API ID должен быть положительным числом.');
  }
  if (!apiHash?.trim()) throw new Error('Введите API Hash.');
  if (!phone?.trim()) throw new Error('Введите номер телефона в международном формате.');

  await closeClient();
  authState = 'connecting';
  authError = '';
  account = null;

  client = new TelegramClient(
    new StringSession(await loadSession()),
    numericApiId,
    apiHash.trim(),
    { connectionRetries: 5 }
  );

  authPromise = client.start({
    phoneNumber: async () => phone.trim(),
    phoneCode: async () => new Promise((resolve) => {
      authState = 'code_required';
      pendingCode = resolve;
    }),
    password: async () => new Promise((resolve) => {
      authState = 'password_required';
      pendingPassword = resolve;
    }),
    onError: async (error) => {
      authError = errorText(error);
      const terminal = terminalAuthErrors.some((code) => String(error?.message || error).includes(code));
      if (terminal) authState = 'error';
      return terminal;
    },
  })
    .then(async () => {
      const user = await client.getMe();
      account = accountView(user);
      authState = 'connected';
      authError = '';
      await saveSession();
    })
    .catch((error) => {
      authState = 'error';
      authError = errorText(error);
    });

  return waitForState();
}

export async function submitTelegramCode(code) {
  if (!pendingCode) throw new Error('Сейчас код не запрашивается.');
  if (!String(code || '').trim()) throw new Error('Введите код из Telegram.');
  const resolve = pendingCode;
  pendingCode = null;
  authState = 'verifying';
  authError = '';
  resolve(String(code).replace(/\s/g, ''));
  return waitForState();
}

export async function submitTelegramPassword(password) {
  if (!pendingPassword) throw new Error('Сейчас пароль не запрашивается.');
  if (!String(password || '')) throw new Error('Введите пароль двухэтапной аутентификации.');
  const resolve = pendingPassword;
  pendingPassword = null;
  authState = 'verifying';
  authError = '';
  resolve(String(password));
  return waitForState();
}

export async function disconnectTelegram() {
  await closeClient();
  authState = 'disconnected';
  authError = '';
  account = null;
  return publicStatus();
}

export function getTelegramStatus() {
  return publicStatus();
}

function requireClient() {
  if (!client || authState !== 'connected') {
    throw new Error('Сначала подключите аккаунт Telegram.');
  }
  return client;
}

function chatView(chat) {
  const id = chat.id?.toString?.() || String(chat.id || '');
  const isChannel = chat.className === 'Channel';
  return {
    id,
    title: chat.title || 'Без названия',
    username: chat.username || '',
    type: isChannel ? (chat.broadcast ? 'channel' : 'group') : 'group',
    participantsCount: chat.participantsCount || null,
    verified: Boolean(chat.verified),
  };
}

export async function searchTelegramChats(query, limit = 20) {
  const activeClient = requireClient();
  const cleanQuery = String(query || '').trim().replace(/^@/, '');
  if (cleanQuery.length < 2) throw new Error('Введите минимум 2 символа для поиска.');
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const result = await activeClient.invoke(new Api.contacts.Search({ q: cleanQuery, limit: safeLimit }));
  const chats = result.chats
    .filter((chat) => ['Chat', 'Channel'].includes(chat.className))
    .map((chat) => {
      const view = chatView(chat);
      entityCache.set(view.id, chat);
      return view;
    });
  return chats;
}

function authorView(sender, fallbackName = '') {
  if (!sender && !fallbackName) return null;
  if (!sender) return { id: `post:${fallbackName}`, name: fallbackName, username: '', phone: '', bot: false };
  const id = sender.id?.toString?.() || String(sender.id || '');
  const name = sender.title || [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.username || 'Без имени';
  return {
    id,
    name,
    username: sender.username || '',
    phone: sender.phone || '',
    bot: Boolean(sender.bot),
  };
}

const phonePattern = /(?:\+?\d[\d\s().-]{8,}\d)/g;
const telegramLinkPattern = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/[a-zA-Z0-9_+/-]+/gi;
const telegramUsernamePattern = /(^|\s)@([a-zA-Z0-9_]{5,32})\b/g;
const websitePattern = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const bareDomainPattern = /\b(?:[a-zA-Z0-9-]+\.)+(?:ru|com|net|org|io|me|biz|pro|site|online|shop)(?:\/[^\s<>"']*)?/gi;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function trimLink(value) {
  return value.replace(/[),.!?;:]+$/g, '');
}

export function extractAdvertContacts(text) {
  const source = String(text || '');
  const phones = unique((source.match(phonePattern) || []).map((value) => {
    const hasPlus = value.trim().startsWith('+');
    const digits = value.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15 ? `${hasPlus ? '+' : ''}${digits}` : '';
  }));

  const telegramLinks = (source.match(telegramLinkPattern) || []).map((value) => {
    const clean = trimLink(value);
    return clean.startsWith('http') ? clean : `https://${clean}`;
  });
  for (const match of source.matchAll(telegramUsernamePattern)) {
    telegramLinks.push(`https://t.me/${match[2]}`);
  }

  const websites = [
    ...(source.match(websitePattern) || []),
    ...(source.match(bareDomainPattern) || []),
  ]
    .map(trimLink)
    .filter((value) => !/(?:^|\/\/)(?:www\.)?(?:t\.me|telegram\.me)\//i.test(value))
    .map((value) => value.startsWith('http') ? value : `https://${value}`);

  return {
    phones,
    websites: unique(websites),
    telegramLinks: unique(telegramLinks),
  };
}

export async function parseTelegramChat({ chatId, limit = 100, search = '' }) {
  const activeClient = requireClient();
  const entity = entityCache.get(String(chatId));
  if (!entity) throw new Error('Чат не найден в текущем поиске. Найдите его заново.');
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const options = { limit: safeLimit };
  if (String(search || '').trim()) options.search = String(search).trim();

  const messages = [];
  const authors = new Map();
  const adverts = [];
  for await (const message of activeClient.iterMessages(entity, options)) {
    let sender;
    try {
      sender = await message.getSender();
    } catch {
      sender = message.sender;
    }
    const author = authorView(sender, message.postAuthor || '');
    if (author) authors.set(author.id, author);
    const text = message.message || (message.media ? '[Медиа]' : '');
    const contacts = extractAdvertContacts(text);
    const parsedMessage = {
      id: message.id,
      date: message.date ? new Date(message.date * 1000).toISOString() : '',
      text,
      authorId: author?.id || '',
      authorName: author?.name || 'Анонимный автор',
      username: author?.username || '',
      views: message.views || 0,
      forwards: message.forwards || 0,
    };
    messages.push(parsedMessage);
    if (contacts.phones.length || contacts.websites.length || contacts.telegramLinks.length) {
      adverts.push({
        messageId: parsedMessage.id,
        date: parsedMessage.date,
        authorName: parsedMessage.authorName,
        text: parsedMessage.text,
        ...contacts,
      });
    }
  }

  return {
    chat: chatView(entity),
    messages,
    authors: [...authors.values()],
    adverts,
  };
}
