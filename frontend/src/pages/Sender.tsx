import React, { useState, useEffect } from 'react';
import { socket } from '../services/socket';

interface LogItem {
  id: string;
  name?: string;
  phone?: string;
  msg: string;
  type: 'success' | 'error' | 'warn' | 'skip';
  time: string;
}

interface Campaign {
  id: number;
  name: string;
  leadsCount: number;
  // We can roughly assume this has leads ready
}

interface Account {
  id: string;
  name: string;
  status: string;
  allow_sender: number;
}

interface Stats {
  sent: number;
  errors: number;
  skipped: number;
  total: number;
}

interface OutreachLead {
  name: string;
  title?: string;
  address?: string;
  platform: string;
  sourceUrl: string;
  socialLinks?: Array<{ platform: string; url: string }>;
  outreachDraft?: string;
}

interface SenderStatus {
  running?: boolean;
  stats?: Stats;
}

interface SenderStartedPayload {
  total: number;
  accounts: number;
}

interface SenderLogPayload {
  message: string;
  type: LogItem['type'];
  name?: string;
  phone?: string;
}

interface SenderErrorPayload {
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getApiError(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    const message = payload.error ?? payload.message;
    if (typeof message === 'string' && message.length > 0) {
      if (message.includes('Database is not configured')) {
        return 'База данных не настроена. Добавьте SUPABASE_DB_URL в backend/.env и перезапустите сервер.';
      }
      return message;
    }
  }
  return fallback;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getApiError(payload, `Ошибка сервера: ${response.status}`));
  }
  return payload;
}

export function Sender() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | ''>('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>(''); // empty means all allowed
  
  const [minDelay, setMinDelay] = useState(15);
  const [maxDelay, setMaxDelay] = useState(45);
  
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [stats, setStats] = useState<Stats>({ sent: 0, errors: 0, skipped: 0, total: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [legacyLoadError, setLegacyLoadError] = useState('');
  const [outreachLeads, setOutreachLeads] = useState<OutreachLead[]>([]);
  const [generatingDrafts, setGeneratingDrafts] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const apiBase = `/api`;

    const loadInitialData = async () => {
      fetchJson(`${apiBase}/saved-map-leads/outreach`)
        .then((outreachData) => {
          if (!isMounted) return;
          if (isRecord(outreachData) && Array.isArray(outreachData.leads)) {
            setOutreachLeads(outreachData.leads as unknown as OutreachLead[]);
          }
          setLoadError('');
        })
        .catch((error: Error) => {
          if (isMounted) setLoadError(error.message || 'Не удалось загрузить очередь Telegram.');
        });
      try {
        const [campaignsData, accountsData, settingsData, statusData, outreachData] = await Promise.all([
          fetchJson(`${apiBase}/campaigns`),
          fetchJson(`${apiBase}/accounts`),
          fetchJson(`${apiBase}/settings`),
          fetchJson(`${apiBase}/sender/status`),
          fetchJson(`${apiBase}/saved-map-leads/outreach`)
        ]);

        if (!isMounted) return;

        setCampaigns(Array.isArray(campaignsData) ? campaignsData as Campaign[] : []);
        setAccounts(
          Array.isArray(accountsData)
            ? (accountsData as Account[]).filter(account => account.allow_sender === 1 && account.status === 'online')
            : []
        );

        if (isRecord(settingsData)) {
          if (settingsData.sender_min_delay_sec) setMinDelay(Number(settingsData.sender_min_delay_sec));
          if (settingsData.sender_max_delay_sec) setMaxDelay(Number(settingsData.sender_max_delay_sec));
        }

        if (isRecord(statusData)) {
          const senderStatus = statusData as SenderStatus;
          setIsRunning(Boolean(senderStatus.running));
          if (senderStatus.stats) setStats(senderStatus.stats);
        }
        if (isRecord(outreachData) && Array.isArray(outreachData.leads)) {
          setOutreachLeads(outreachData.leads as unknown as OutreachLead[]);
        }
        setLoadError('');
      } catch (error) {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : 'Не удалось загрузить данные рассылки.';
        setCampaigns([]);
        setAccounts([]);
        setLegacyLoadError(message);
      }
    };

    void loadInitialData();

    // Socket events
    const onStarted = (data: SenderStartedPayload) => {
      setIsRunning(true);
      addLog({ id: Date.now().toString(), msg: `Запущена рассылка: ${data.total} лидов, ${data.accounts} аккаунтов`, type: 'success', time: new Date().toLocaleTimeString() });
    };
    const onLog = (data: SenderLogPayload) => {
      addLog({
        id: Date.now().toString() + Math.random(),
        msg: data.message,
        type: data.type,
        time: new Date().toLocaleTimeString(),
        name: data.name,
        phone: data.phone
      });
    };
    const onStats = (data: Stats) => setStats(data);
    const onPaused = (data: Stats) => {
      setIsRunning(false);
      setStats(data);
      addLog({ id: Date.now().toString(), msg: `Рассылка поставлена на паузу`, type: 'warn', time: new Date().toLocaleTimeString() });
    };
    const onDone = (data: Stats) => {
      setIsRunning(false);
      setStats(data);
      addLog({ id: Date.now().toString(), msg: `Рассылка завершена`, type: 'success', time: new Date().toLocaleTimeString() });
    };
    const onError = (data: SenderErrorPayload) => {
      setIsRunning(false);
      addLog({ id: Date.now().toString(), msg: `Критическая ошибка: ${data.message}`, type: 'error', time: new Date().toLocaleTimeString() });
    };

    socket.on('sender:started', onStarted);
    socket.on('sender:log', onLog);
    socket.on('sender:stats', onStats);
    socket.on('sender:paused', onPaused);
    socket.on('sender:done', onDone);
    socket.on('sender:error', onError);

    return () => {
      isMounted = false;
      socket.off('sender:started', onStarted);
      socket.off('sender:log', onLog);
      socket.off('sender:stats', onStats);
      socket.off('sender:paused', onPaused);
      socket.off('sender:done', onDone);
      socket.off('sender:error', onError);
    };
  }, []);

  const addLog = (log: LogItem) => {
    setLogs(prev => [log, ...prev].slice(0, 100)); // keep last 100
  };

  const startSending = async () => {
    try {
      // Save settings first
      await fetch(`/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sender_min_delay_sec: minDelay,
          sender_max_delay_sec: maxDelay
        })
      });

      // Start sending
      const res = await fetch(`/api/sender/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: selectedCampaignId || null,
          account_ids: selectedAccountId ? [selectedAccountId] : null
        })
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.message);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка при старте');
    }
  };

  const pauseSending = async () => {
    try {
      await fetch(`/api/sender/pause`, { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
  };

  const generateOutreachDrafts = async () => {
    setGeneratingDrafts(true);
    try {
      const response = await fetch(`/api/saved-map-leads/outreach/generate-drafts`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось подготовить сообщения.');
      setOutreachLeads(data.leads || []);
      if (!data.aiAvailable) {
        addLog({ id: Date.now().toString(), msg: 'Ollama недоступна: подготовлены безопасные шаблонные черновики.', type: 'warn', time: new Date().toLocaleTimeString() });
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Не удалось подготовить сообщения.');
    } finally {
      setGeneratingDrafts(false);
    }
  };

  const updateOutreachDraft = async (lead: OutreachLead, outreachDraft: string) => {
    setOutreachLeads((current) => current.map((item) => item.sourceUrl === lead.sourceUrl && item.platform === lead.platform ? { ...item, outreachDraft } : item));
    await fetch(`/api/saved-map-leads/outreach/draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: lead.platform, sourceUrl: lead.sourceUrl, outreachDraft }),
    });
  };

  const removeOutreachLead = async (lead: OutreachLead) => {
    const response = await fetch(`/api/saved-map-leads/outreach`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: lead.platform, sourceUrl: lead.sourceUrl }),
    });
    const data = await response.json();
    if (response.ok) setOutreachLeads(data.leads || []);
  };

  const telegramUrl = (lead: OutreachLead) => lead.socialLinks?.find((social) => social.platform.toLowerCase() === 'telegram')?.url || '';

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <h1 className="page-title">Рассылка</h1>
          <div className="text-secondary mt-1">Автоматическая отправка сообщений по базам</div>
        </div>
      </div>

      <div className="page-body flex flex-col gap-6">
        {loadError ? <div className="telegram-alert">{loadError}</div> : null}

        <div className="card outreach-queue-card">
          <div className="outreach-queue-header">
            <div><span className="card-title">Очередь Telegram</span><p>Контакты, выбранные в Google, Яндекс Картах и 2ГИС. Проверьте черновик перед отправкой.</p></div>
            <button className="btn btn-primary" onClick={generateOutreachDrafts} disabled={!outreachLeads.length || generatingDrafts}>{generatingDrafts ? 'Генерируем…' : 'Подготовить разные сообщения'}</button>
          </div>
          <div className="outreach-queue-list">
            {outreachLeads.map((lead) => <article className="outreach-queue-item" key={`${lead.platform}:${lead.sourceUrl}`}>
              <div className="outreach-queue-company"><strong>{lead.name}</strong><span>{lead.title || lead.address || 'Компания из карт'}</span></div>
              <textarea value={lead.outreachDraft || ''} onChange={(event) => setOutreachLeads((current) => current.map((item) => item.sourceUrl === lead.sourceUrl && item.platform === lead.platform ? { ...item, outreachDraft: event.target.value } : item))} onBlur={(event) => updateOutreachDraft(lead, event.target.value)} placeholder="Нажмите «Подготовить разные сообщения» или напишите текст вручную" />
              <div className="outreach-queue-actions"><a className={`btn btn-secondary ${!telegramUrl(lead) ? 'disabled' : ''}`} href={telegramUrl(lead) || undefined} target="_blank" rel="noreferrer">Открыть Telegram</a><button className="maps-remove-button" onClick={() => removeOutreachLead(lead)}>Убрать</button></div>
            </article>)}
            {!outreachLeads.length ? <div className="text-secondary text-center py-10">Выберите компании кнопкой «В рассылку» на странице любого парсера карт.</div> : null}
          </div>
        </div>
        
        <div className="card" style={{ padding: '2rem' }}>
          {legacyLoadError ? <div className="sender-module-note">{legacyLoadError}</div> : null}
          <span className="card-title mb-6">Настройка кампании</span>
          <div className="grid-2 mb-6" style={{ gap: '2rem' }}>
            <div>
              <label className="form-label mb-2">База лидов</label>
              <select className="form-select" disabled={isRunning} value={selectedCampaignId} onChange={e => setSelectedCampaignId(Number(e.target.value) || '')}>
                <option value="">Все готовые лиды из всех баз</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name} (Всего лидов: {c.leadsCount})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label mb-2">Используемые аккаунты</label>
              <select className="form-select" disabled={isRunning} value={selectedAccountId} onChange={e => setSelectedAccountId(e.target.value)}>
                <option value="">Все доступные онлайн-аккаунты ({accounts.length})</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name || a.id}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="mb-6">
            <label className="form-label mb-2">Задержка между сообщениями (сек)</label>
            <div className="flex gap-4 items-center" style={{ maxWidth: '320px' }}>
              <input type="number" className="form-input w-full" disabled={isRunning} value={minDelay} onChange={e => setMinDelay(Number(e.target.value))} />
              <span className="text-secondary">—</span>
              <input type="number" className="form-input w-full" disabled={isRunning} value={maxDelay} onChange={e => setMaxDelay(Number(e.target.value))} />
            </div>
            <div className="text-sm text-secondary mt-2">Каждое сообщение отправляется со случайной задержкой в этом диапазоне, имитируя человека.</div>
          </div>

          <div className="flex gap-4 pt-6" style={{ borderTop: '1px solid var(--color-border-weak)' }}>
            {!isRunning ? (
              <button disabled={Boolean(legacyLoadError)} onClick={startSending} className="btn btn-primary flex-1" style={{ maxWidth: '240px', justifyContent: 'center', padding: '12px' }}>
                ▶ Запустить рассылку
              </button>
            ) : (
              <button onClick={pauseSending} className="btn btn-secondary flex-1" style={{ maxWidth: '240px', justifyContent: 'center', padding: '12px' }}>
                ⏸ Пауза
              </button>
            )}
            
            <div className="flex gap-6 items-center ml-auto">
              <div className="flex flex-col">
                <span className="text-secondary text-sm">Отправлено</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-primary)' }}>{stats.sent}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-secondary text-sm">Ошибки</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-error)' }}>{stats.errors}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-secondary text-sm">Всего</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 600 }}>{stats.total}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card flex flex-col" style={{ padding: '2rem', flex: 1, minHeight: '400px' }}>
          <span className="card-title mb-6">Монитор в реальном времени</span>
          
          <div className="flex flex-col gap-4 overflow-y-auto" style={{ maxHeight: '600px' }}>
            {logs.length === 0 && <div className="text-secondary text-center py-10">Лог рассылки пуст...</div>}
            
            {logs.map(item => (
              <div key={item.id} className="flex justify-between items-center p-4 rounded-xl border" style={{ backgroundColor: '#F9FAFB', borderColor: 'var(--color-border-weak)' }}>
                <div className="flex items-center gap-4 flex-1">
                  <div className="mono text-sm text-secondary" style={{ width: '70px' }}>{item.time}</div>
                  <div className="text-sm" style={{ color: '#111827', flex: 1 }}>{item.msg}</div>
                </div>
                <div style={{ width: '100px', textAlign: 'right' }}>
                  {item.type === 'success' && <span className="badge badge-online">Успешно</span>}
                  {item.type === 'error' && <span className="badge" style={{ backgroundColor: 'var(--color-error-bg)', color: 'var(--color-error)' }}>Ошибка</span>}
                  {item.type === 'warn' && <span className="badge" style={{ backgroundColor: '#FEF3C7', color: '#B45309' }}>Внимание</span>}
                  {item.type === 'skip' && <span className="badge badge-new">Пропущено</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
