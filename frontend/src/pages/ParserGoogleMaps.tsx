import React, { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../services/socket';

interface SocialLink {
  platform: string;
  url: string;
}

interface MapLead {
  name: string;
  title: string;
  phone: string;
  website: string;
  rating: string;
  address: string;
  description?: string;
  socialLinks?: SocialLink[];
  sourceUrl: string;
  isClaimed: boolean;
  platform: 'google_maps' | 'yandex_maps';
}

type PresenceFilter = 'all' | 'with' | 'without';
type MapsProvider = 'google' | 'yandex';

interface ParserProgress {
  current: number;
  total: number;
  matched: number;
  checked: number;
  target: number;
}

const providerConfig = {
  google: {
    name: 'Google Карты',
    platform: 'google_maps' as const,
    endpoint: 'google-maps',
    storage: 'gm',
  },
  yandex: {
    name: 'Яндекс Карты',
    platform: 'yandex_maps' as const,
    endpoint: 'yandex-maps',
    storage: 'ym',
  },
};

function csvCell(value: string | boolean) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function downloadCsv(leads: MapLead[], provider: MapsProvider) {
  const rows = [
    ['Название', 'Категория', 'Телефон', 'Сайт', 'Соцсети', 'Рейтинг', 'Адрес', 'Описание', 'Карточка'],
    ...leads.map((lead) => [
      lead.name,
      lead.title,
      lead.phone,
      lead.website,
      (lead.socialLinks || []).map((social) => `${social.platform}: ${social.url}`).join(', '),
      lead.rating,
      lead.address,
      lead.description || '',
      lead.sourceUrl,
    ]),
  ];
  const content = '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${provider}-maps-leads.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function MapsParser({ provider }: { provider: MapsProvider }) {
  const navigate = useNavigate();
  const config = providerConfig[provider];
  const api = `http://${window.location.hostname}:3001/api/${config.endpoint}`;
  const [query, setQuery] = useState(() => localStorage.getItem(`${config.storage}_query`) || '');
  const [targetCount, setTargetCount] = useState(() => Number(localStorage.getItem(`${config.storage}_target`)) || 30);
  const [websiteFilter, setWebsiteFilter] = useState<PresenceFilter>(() => (localStorage.getItem(`${config.storage}_website`) as PresenceFilter) || 'all');
  const [phoneFilter, setPhoneFilter] = useState<PresenceFilter>(() => (localStorage.getItem(`${config.storage}_phone`) as PresenceFilter) || 'all');
  const [socialFilter, setSocialFilter] = useState<PresenceFilter>(() => (localStorage.getItem(`${config.storage}_socials`) as PresenceFilter) || 'all');
  const [leads, setLeads] = useState<MapLead[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ParserProgress>({ current: 0, total: 0, matched: 0, checked: 0, target: 30 });
  const [error, setError] = useState('');
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    localStorage.setItem(`${config.storage}_query`, query);
    localStorage.setItem(`${config.storage}_target`, String(targetCount));
    localStorage.setItem(`${config.storage}_website`, websiteFilter);
    localStorage.setItem(`${config.storage}_phone`, phoneFilter);
    localStorage.setItem(`${config.storage}_socials`, socialFilter);
  }, [config.storage, phoneFilter, query, socialFilter, targetCount, websiteFilter]);

  useEffect(() => {
    const onStarted = (data: { platform: string; targetCount?: number }) => {
      if (data.platform !== config.platform) return;
      const target = data.targetCount || targetCount;
      setLoading(true);
      setLeads([]);
      setLogs([`Парсер запущен. Ищем ${target} подходящих компаний в ${config.name}…`]);
      setProgress({ current: 0, total: 0, matched: 0, checked: 0, target });
    };
    const onProgress = (data: {
      platform?: string;
      currentPage: number;
      totalPages: number;
      matchedCount?: number;
      candidatesChecked?: number;
      targetCount?: number;
    }) => {
      if (data.platform !== config.platform) return;
      setProgress({
        current: data.currentPage,
        total: data.totalPages,
        matched: data.matchedCount || 0,
        checked: data.candidatesChecked || 0,
        target: data.targetCount || targetCount,
      });
    };
    const onLead = (data: { lead: MapLead }) => {
      if (data.lead.platform !== config.platform) return;
      setLeads((current) => current.some((lead) => lead.sourceUrl === data.lead.sourceUrl) ? current : [data.lead, ...current]);
    };
    const onLog = (data: { message: string }) => {
      setLogs((current) => [`[${new Date().toLocaleTimeString('ru-RU')}] ${data.message}`, ...current].slice(0, 300));
    };
    const onDone = (data?: { platform?: string }) => {
      if (data?.platform !== config.platform) return;
      setLoading(false);
    };

    socket.on('parser:started', onStarted);
    socket.on('parser:progress', onProgress);
    socket.on('parser:lead', onLead);
    socket.on('parser:log', onLog);
    socket.on('parser:done', onDone);
    fetch(`${api}/status`)
      .then((response) => response.json())
      .then((data: { isRunning?: boolean }) => setLoading(Boolean(data.isRunning)))
      .catch(() => undefined);

    return () => {
      socket.off('parser:started', onStarted);
      socket.off('parser:progress', onProgress);
      socket.off('parser:lead', onLead);
      socket.off('parser:log', onLog);
      socket.off('parser:done', onDone);
    };
  }, [api, config.name, config.platform, targetCount]);

  const startParsing = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (query.trim().length < 3) {
      setError('Введите запрос: например, Москва натяжные потолки.');
      return;
    }
    try {
      const response = await fetch(`${api}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          targetCount,
          filters: { website: websiteFilter, phone: phoneFilter, socials: socialFilter },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось запустить парсер.');
    } catch (requestError) {
      setLoading(false);
      setError(requestError instanceof Error ? requestError.message : 'Не удалось запустить парсер.');
    }
  };

  const stopParsing = async () => {
    await fetch(`${api}/stop`, { method: 'POST' }).catch(() => undefined);
    setLoading(false);
  };

  const progressPercent = progress.target ? Math.min(100, Math.round((progress.matched / progress.target) * 100)) : 0;

  return (
    <div className={`maps-page ${provider}`}>
      <header className="telegram-header maps-header">
        <button className="telegram-back" onClick={() => navigate('/parser')} aria-label="Назад">←</button>
        <div>
          <span className="telegram-kicker">ПАРСЕР / {config.name.toUpperCase()}</span>
          <h1>Поиск компаний по заданным условиям</h1>
          <p>Парсер пропускает неподходящие карточки и продолжает поиск, пока не соберёт указанное количество.</p>
        </div>
        <span className={`telegram-status ${loading ? 'online' : ''}`}><i />{loading ? 'Сбор идёт' : 'Готов к запуску'}</span>
      </header>

      <main className="telegram-body maps-body">
        {error ? <div className="telegram-alert">{error}</div> : null}
        <section className="maps-flow" aria-label="Как работает парсер">
          <div><b>01</b><span>Запрос</span><small>Москва натяжные потолки</small></div><i>→</i>
          <div><b>02</b><span>Условия</span><small>Например: без сайта, с телефоном</small></div><i>→</i>
          <div><b>03</b><span>Цель</span><small>30 подходящих компаний</small></div>
        </section>

        <section className="maps-workspace">
          <form className="telegram-panel maps-search-panel" onSubmit={startParsing}>
            <span className="panel-label">НАСТРОЙКИ СБОРА</span>
            <h2>Кого нужно найти?</h2>
            <label>Город + ниша или услуга</label>
            <input className="form-input maps-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Москва натяжные потолки" disabled={loading} />

            <div className="maps-target-row">
              <div>
                <label>Сколько подходящих компаний</label>
                <select className="form-input" value={targetCount} onChange={(event) => setTargetCount(Number(event.target.value))} disabled={loading}>
                  <option value={10}>10 компаний</option>
                  <option value={30}>30 компаний</option>
                  <option value={50}>50 компаний</option>
                  <option value={100}>100 компаний</option>
                </select>
              </div>
              <div className="maps-server-filter-note"><b>Фильтры работают во время поиска</b><span>Неподходящие компании не попадают в результат.</span></div>
            </div>

            <div className="maps-filter-bar maps-filter-settings">
              <label>Сайт<select value={websiteFilter} onChange={(event) => setWebsiteFilter(event.target.value as PresenceFilter)} disabled={loading}><option value="all">Неважно</option><option value="with">Есть сайт</option><option value="without">Нет сайта</option></select></label>
              <label>Телефон<select value={phoneFilter} onChange={(event) => setPhoneFilter(event.target.value as PresenceFilter)} disabled={loading}><option value="all">Неважно</option><option value="with">Есть телефон</option><option value="without">Нет телефона</option></select></label>
              <label>Соцсети<select value={socialFilter} onChange={(event) => setSocialFilter(event.target.value as PresenceFilter)} disabled={loading}><option value="all">Неважно</option><option value="with">Есть соцсети</option><option value="without">Нет соцсетей</option></select></label>
            </div>

            {loading ? <button type="button" className="btn btn-secondary maps-start" onClick={stopParsing}>Остановить сбор</button> : <button className="btn btn-primary maps-start">Найти {targetCount} подходящих компаний</button>}
            {loading ? <div className="maps-progress"><span style={{ width: `${progressPercent}%` }} /><small>Подходит {progress.matched} из {progress.target} · проверено карточек: {progress.checked}</small></div> : null}
          </form>
          <aside className="telegram-note maps-note"><b>Важно</b><p>Если выбрано «Нет сайта + Есть телефон + Есть соцсети», парсер будет проверять выдачу дальше, а не остановится на первых 30 карточках.</p><small>Если таких компаний в выдаче меньше цели, журнал покажет, сколько найдено и сколько карточек проверено.</small></aside>
        </section>

        <section className="telegram-results maps-results">
          <div className="results-heading">
            <div><span className="panel-label">РЕЗУЛЬТАТ ПО УСЛОВИЯМ</span><h2>Подходящие компании</h2></div>
            <div className="result-metrics"><span><b>{leads.length}</b> найдено</span><span><b>{progress.checked}</b> проверено</span><span><b>{progress.target || targetCount}</b> цель</span></div>
          </div>
          <div className="maps-result-actions"><span>В таблице только компании, прошедшие выбранные фильтры.</span><button className="btn btn-secondary" onClick={() => downloadCsv(leads, provider)} disabled={!leads.length}>Скачать CSV</button></div>
          <div className="telegram-table-wrap"><table><thead><tr><th>Компания</th><th>Телефон</th><th>Сайт</th><th>Соцсети</th><th>Адрес</th><th>Рейтинг</th></tr></thead><tbody>
            {leads.map((lead) => <tr key={lead.sourceUrl}>
              <td><a href={lead.sourceUrl} target="_blank" rel="noreferrer">{lead.name || 'Без названия'}</a><small className="maps-category">{lead.title}</small></td>
              <td>{lead.phone || '—'}</td>
              <td>{lead.website ? <a href={lead.website} target="_blank" rel="noreferrer">Открыть сайт</a> : <span className="maps-missing">Нет сайта</span>}</td>
              <td><div className="maps-socials">{lead.socialLinks?.length ? lead.socialLinks.map((social) => <a key={social.url} href={social.url} target="_blank" rel="noreferrer">{social.platform}</a>) : <span className="maps-missing">Не найдены</span>}</div></td>
              <td>{lead.address || '—'}</td><td>{lead.rating || '—'}</td>
            </tr>)}
            {!leads.length ? <tr><td colSpan={6} className="telegram-empty">{loading ? `Проверяем выдачу: найдено ${progress.matched} из ${progress.target}…` : 'Настройте условия и запустите поиск'}</td></tr> : null}
          </tbody></table></div>
          <button className="maps-log-toggle" onClick={() => setShowLogs((visible) => !visible)}>{showLogs ? 'Скрыть журнал' : `Показать журнал (${logs.length})`}</button>
          {showLogs ? <div className="maps-logs">{logs.length ? logs.map((log, index) => <div key={`${index}-${log}`}>{log}</div>) : <div>Ждём запуска парсера…</div>}</div> : null}
        </section>
      </main>
    </div>
  );
}

export function ParserGoogleMaps() {
  return <MapsParser provider="google" />;
}
