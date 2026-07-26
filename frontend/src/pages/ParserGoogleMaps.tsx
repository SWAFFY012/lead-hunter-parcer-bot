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
  platform: 'google_maps' | 'yandex_maps' | 'two_gis_maps';
  savedAt?: string;
  contactedAt?: string;
}

type PresenceFilter = 'all' | 'with' | 'without';
type SocialPlatformFilter = 'all' | 'telegram';
type MapsProvider = 'google' | 'yandex' | 'twoGis';
const targetOptions = [1, 3, 5, 10, 30, 50, 100] as const;

function getParserStartError(requestError: unknown) {
  if (requestError instanceof TypeError) {
    return 'Сервер парсеров недоступен. Запустите файл start-host.cmd в папке проекта и повторите попытку.';
  }
  return requestError instanceof Error ? requestError.message : 'Не удалось запустить парсер.';
}

interface ParserProgress {
  current: number;
  total: number;
  matched: number;
  checked: number;
  target: number;
}

interface ParserStatusResponse {
  isRunning?: boolean;
  leads?: MapLead[];
  progress?: Partial<ParserProgress>;
  targetCount?: number;
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
  twoGis: {
    name: '2ГИС',
    platform: 'two_gis_maps' as const,
    endpoint: '2gis-maps',
    storage: '2gis',
  },
};

function csvCell(value: string | boolean) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function normalizeCompanyName(name: string) {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'.,()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function companyWord(count: number) {
  if (count === 1) return 'подходящую компанию';
  if (count > 1 && count < 5) return 'подходящие компании';
  return 'подходящих компаний';
}

function downloadCsv(leads: MapLead[], provider: MapsProvider | 'saved') {
  const rows = [
    ['Название', 'Категория', 'Телефон', 'Сайт', 'Соцсети', 'Рейтинг', 'Адрес', 'Описание', 'Карточка', 'Написал'],
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
      lead.contactedAt ? new Date(lead.contactedAt).toLocaleDateString('ru-RU') : 'Нет',
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
  const savedApi = `http://${window.location.hostname}:3001/api/saved-map-leads`;
  const [query, setQuery] = useState(() => localStorage.getItem(`${config.storage}_query`) || '');
  const [targetCount, setTargetCount] = useState(() => {
    const savedTarget = Number(localStorage.getItem(`${config.storage}_target_v2`));
    return targetOptions.includes(savedTarget as typeof targetOptions[number]) ? savedTarget : 5;
  });
  const [websiteFilter, setWebsiteFilter] = useState<PresenceFilter>(() => (localStorage.getItem(`${config.storage}_website`) as PresenceFilter) || 'all');
  const [phoneFilter, setPhoneFilter] = useState<PresenceFilter>(() => (localStorage.getItem(`${config.storage}_phone`) as PresenceFilter) || 'all');
  const [socialFilter, setSocialFilter] = useState<PresenceFilter>(() => (localStorage.getItem(`${config.storage}_socials`) as PresenceFilter) || 'all');
  const [socialPlatformFilter, setSocialPlatformFilter] = useState<SocialPlatformFilter>(() => (localStorage.getItem(`${config.storage}_social_platform`) as SocialPlatformFilter) || 'all');
  const [leads, setLeads] = useState<MapLead[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ParserProgress>({ current: 0, total: 0, matched: 0, checked: 0, target: targetCount });
  const [error, setError] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [savedLeads, setSavedLeads] = useState<MapLead[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const [contactUpdating, setContactUpdating] = useState<Set<string>>(() => new Set());
  const [ignoring, setIgnoring] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    localStorage.setItem(`${config.storage}_query`, query);
    localStorage.setItem(`${config.storage}_target_v2`, String(targetCount));
    localStorage.setItem(`${config.storage}_website`, websiteFilter);
    localStorage.setItem(`${config.storage}_phone`, phoneFilter);
    localStorage.setItem(`${config.storage}_socials`, socialFilter);
    localStorage.setItem(`${config.storage}_social_platform`, socialPlatformFilter);
  }, [config.storage, phoneFilter, query, socialFilter, socialPlatformFilter, targetCount, websiteFilter]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(savedApi, { signal: controller.signal })
      .then((response) => response.json())
      .then((data: { leads?: MapLead[] }) => setSavedLeads(data.leads || []))
      .catch((requestError: Error) => {
        if (requestError.name !== 'AbortError') setError('Не удалось загрузить сохранённые компании.');
      });
    return () => controller.abort();
  }, [savedApi]);

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
    const onLog = (data: { platform?: string; message: string }) => {
      if (data.platform !== config.platform) return;
      setLogs((current) => [`[${new Date().toLocaleTimeString('ru-RU')}] ${data.message}`, ...current].slice(0, 300));
    };
    const onDone = (data?: { platform?: string }) => {
      if (data?.platform !== config.platform) return;
      setLoading(false);
    };
    const onLeadRemoved = (data: { platform?: string; normalizedName?: string }) => {
      if (data.platform !== config.platform || !data.normalizedName) return;
      setLeads((current) => current.filter((lead) => normalizeCompanyName(lead.name) !== data.normalizedName));
    };

    socket.on('parser:started', onStarted);
    socket.on('parser:progress', onProgress);
    socket.on('parser:lead', onLead);
    socket.on('parser:log', onLog);
    socket.on('parser:done', onDone);
    socket.on('parser:lead-removed', onLeadRemoved);
    fetch(`${api}/status`)
      .then((response) => response.json())
      .then((data: ParserStatusResponse) => {
        setLoading(Boolean(data.isRunning));
        setLeads(data.leads || []);
        if (data.progress) {
          setProgress({
            current: data.progress.current ?? 0,
            total: data.progress.total ?? 0,
            matched: data.progress.matched ?? data.leads?.length ?? 0,
            checked: data.progress.checked ?? 0,
            target: data.progress.target ?? data.targetCount ?? targetCount,
          });
        }
      })
      .catch(() => undefined);

    return () => {
      socket.off('parser:started', onStarted);
      socket.off('parser:progress', onProgress);
      socket.off('parser:lead', onLead);
      socket.off('parser:log', onLog);
      socket.off('parser:done', onDone);
      socket.off('parser:lead-removed', onLeadRemoved);
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
      setLoading(true);
      setLeads([]);
      setLogs([`Отправляем задачу в ${config.name}…`]);
      setProgress({ current: 0, total: 0, matched: 0, checked: 0, target: targetCount });
      const response = await fetch(`${api}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          targetCount,
          filters: {
            website: websiteFilter,
            phone: phoneFilter,
            socials: socialFilter,
            socialPlatform: socialPlatformFilter,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось запустить парсер.');
    } catch (requestError) {
      setLoading(false);
      setError(getParserStartError(requestError));
    }
  };

  const stopParsing = async () => {
    await fetch(`${api}/stop`, { method: 'POST' }).catch(() => undefined);
    setLoading(false);
  };

  const saveCompanies = async (companies: MapLead[]) => {
    if (!companies.length) return;
    setSaving(true);
    setSavedNotice('');
    try {
      const response = await fetch(savedApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: companies }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить компании.');
      setSavedLeads(data.leads || []);
      setSavedNotice(companies.length === 1 ? 'Компания сохранена для дальнейшей работы.' : `Сохранено компаний: ${companies.length}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось сохранить компании.');
    } finally {
      setSaving(false);
    }
  };

  const removeSavedCompany = async (lead: MapLead) => {
    try {
      const response = await fetch(savedApi, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: lead.platform, sourceUrl: lead.sourceUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось удалить компанию.');
      setSavedLeads(data.leads || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось удалить компанию.');
    }
  };

  const removeAllSavedCompanies = async () => {
    try {
      const response = await fetch(`${savedApi}/all`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось очистить сохранённые компании.');
      setSavedLeads(data.leads || []);
      setSavedNotice('Сохранённый список очищен.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось очистить сохранённые компании.');
    }
  };

  const toggleContacted = async (lead: MapLead) => {
    const key = `${lead.platform}:${lead.sourceUrl}`;
    setContactUpdating((current) => new Set(current).add(key));
    setError('');
    try {
      const response = await fetch(`${savedApi}/contacted`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: lead.platform,
          sourceUrl: lead.sourceUrl,
          contacted: !lead.contactedAt,
        }),
      });
      const data: { error?: string; lead?: MapLead } = await response.json();
      if (!response.ok || !data.lead) throw new Error(data.error || 'Не удалось сохранить отметку.');
      const replaceLead = (current: MapLead[]) => current.map((item) => (
        item.platform === data.lead?.platform && item.sourceUrl === data.lead.sourceUrl
          ? { ...item, ...data.lead }
          : item
      ));
      setLeads(replaceLead);
      setSavedLeads(replaceLead);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось сохранить отметку.');
    } finally {
      setContactUpdating((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const ignoreCompany = async (lead: MapLead) => {
    if (!window.confirm(`Больше не показывать компанию «${lead.name}» в результатах ${config.name}?`)) return;
    const normalizedName = normalizeCompanyName(lead.name);
    setIgnoring((current) => new Set(current).add(normalizedName));
    setError('');
    try {
      const response = await fetch(`${savedApi}/ignore-name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: lead.platform, name: lead.name }),
      });
      const data: { error?: string; ignoredName?: string } = await response.json();
      if (!response.ok || !data.ignoredName) throw new Error(data.error || 'Не удалось скрыть компанию.');
      setLeads((current) => current.filter((item) => normalizeCompanyName(item.name) !== data.ignoredName));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось скрыть компанию.');
    } finally {
      setIgnoring((current) => {
        const next = new Set(current);
        next.delete(normalizedName);
        return next;
      });
    }
  };

  const progressPercent = progress.target ? Math.min(100, Math.round((progress.matched / progress.target) * 100)) : 0;
  const savedSourceUrls = new Set(savedLeads.map((lead) => lead.sourceUrl));
  const unsavedLeads = leads.filter((lead) => !savedSourceUrls.has(lead.sourceUrl));

  return (
    <div className={`maps-page ${provider === 'twoGis' ? 'twogis' : provider}`}>
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
          <div><b>03</b><span>Цель</span><small>1, 3, 5 или больше компаний</small></div>
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
                  {targetOptions.map((value) => <option key={value} value={value}>{value} {value === 1 ? 'компания' : value < 5 ? 'компании' : 'компаний'}</option>)}
                </select>
              </div>
              <div className="maps-server-filter-note"><b>Фильтры работают во время поиска</b><span>Неподходящие компании не попадают в результат.</span></div>
            </div>

            <div className="maps-filter-bar maps-filter-settings">
              <label>Сайт<select value={websiteFilter} onChange={(event) => setWebsiteFilter(event.target.value as PresenceFilter)} disabled={loading}><option value="all">Неважно</option><option value="with">Есть сайт</option><option value="without">Нет сайта</option></select></label>
              <label>Телефон<select value={phoneFilter} onChange={(event) => setPhoneFilter(event.target.value as PresenceFilter)} disabled={loading}><option value="all">Неважно</option><option value="with">Есть телефон</option><option value="without">Нет телефона</option></select></label>
              <label>Telegram / WhatsApp / Instagram<select value={socialFilter} onChange={(event) => setSocialFilter(event.target.value as PresenceFilter)} disabled={loading}><option value="all">Неважно</option><option value="with">Есть хотя бы одна</option><option value="without">Нет ни одной</option></select></label>
              <label>Telegram<select value={socialPlatformFilter} onChange={(event) => setSocialPlatformFilter(event.target.value as SocialPlatformFilter)} disabled={loading}><option value="all">Неважно</option><option value="telegram">Только с Telegram</option></select></label>
            </div>

            {loading ? <button type="button" className="btn btn-secondary maps-start" onClick={stopParsing}>Остановить сбор</button> : <button className="btn btn-primary maps-start">Найти {targetCount} {companyWord(targetCount)}</button>}
            {loading ? <div className="maps-progress"><span style={{ width: `${progressPercent}%` }} /><small>Подходит {progress.matched} из {progress.target} · проверено карточек: {progress.checked}</small></div> : null}
          </form>
          <aside className="telegram-note maps-note"><b>Быстрый режим</b><p>Собираются только Telegram, WhatsApp и Instagram. Достаточно любой одной найденной соцсети.</p><small>Если ссылка уже есть в карточке компании, сайт дополнительно не проверяется.</small></aside>
        </section>

        <section className="telegram-results maps-results">
          <div className="results-heading">
            <div><span className="panel-label">РЕЗУЛЬТАТ ПО УСЛОВИЯМ</span><h2>Подходящие компании</h2></div>
            <div className="result-metrics"><span><b>{leads.length}</b> найдено</span><span><b>{progress.checked}</b> проверено</span><span><b>{progress.target || targetCount}</b> цель</span></div>
          </div>
          <div className="maps-result-actions"><span>В таблице только компании, прошедшие выбранные фильтры.</span><div className="maps-action-buttons"><button className="btn btn-primary" onClick={() => saveCompanies(unsavedLeads)} disabled={!unsavedLeads.length || saving}>{saving ? 'Сохраняем…' : 'Сохранить все'}</button><button className="btn btn-secondary" onClick={() => downloadCsv(leads, provider)} disabled={!leads.length}>Скачать CSV</button></div></div>
          {savedNotice ? <div className="maps-saved-notice">✓ {savedNotice}</div> : null}
          <div className="telegram-table-wrap"><table><thead><tr><th>Компания</th><th>Телефон</th><th>Сайт</th><th>Соцсети</th><th>Адрес</th><th>Рейтинг</th><th>Написал</th><th>Сохранение</th></tr></thead><tbody>
            {leads.map((lead) => <tr key={lead.sourceUrl}>
              <td><a href={lead.sourceUrl} target="_blank" rel="noreferrer">{lead.name || 'Без названия'}</a><small className="maps-category">{lead.title}</small></td>
              <td>{lead.phone || '—'}</td>
              <td>{lead.website ? <a href={lead.website} target="_blank" rel="noreferrer">Открыть сайт</a> : <span className="maps-missing">Нет сайта</span>}</td>
              <td><div className="maps-socials">{lead.socialLinks?.length ? lead.socialLinks.map((social) => <a key={social.url} href={social.url} target="_blank" rel="noreferrer">{social.platform}</a>) : <span className="maps-missing">Не найдены</span>}</div></td>
              <td>{lead.address || '—'}</td><td>{lead.rating || '—'}</td>
              <td><label className={`maps-contact-check ${lead.contactedAt ? 'contacted' : ''}`}><input type="checkbox" checked={Boolean(lead.contactedAt)} onChange={() => toggleContacted(lead)} disabled={contactUpdating.has(`${lead.platform}:${lead.sourceUrl}`)} /><span>{lead.contactedAt ? 'Написал' : 'Не написал'}</span></label></td>
              <td><div className="maps-row-actions"><button className={`maps-save-button ${savedSourceUrls.has(lead.sourceUrl) ? 'saved' : ''}`} onClick={() => saveCompanies([lead])} disabled={savedSourceUrls.has(lead.sourceUrl) || saving}>{savedSourceUrls.has(lead.sourceUrl) ? '✓ Сохранено' : 'Сохранить'}</button>{provider === 'yandex' ? <button className="maps-ignore-button" onClick={() => ignoreCompany(lead)} disabled={ignoring.has(normalizeCompanyName(lead.name))}>Скрыть</button> : null}</div></td>
            </tr>)}
            {!leads.length ? <tr><td colSpan={8} className="telegram-empty">{loading ? `Проверяем выдачу: найдено ${progress.matched} из ${progress.target}…` : 'Настройте условия и запустите поиск'}</td></tr> : null}
          </tbody></table></div>
          <button className="maps-log-toggle" onClick={() => setShowLogs((visible) => !visible)}>{showLogs ? 'Скрыть журнал' : `Показать журнал (${logs.length})`}</button>
          {showLogs ? <div className="maps-logs">{logs.length ? logs.map((log, index) => <div key={`${index}-${log}`}>{log}</div>) : <div>Ждём запуска парсера…</div>}</div> : null}
        </section>

        <section className="telegram-results maps-saved-results">
          <div className="results-heading">
            <div><span className="panel-label">МОЯ БАЗА ДЛЯ СВЯЗИ</span><h2>Сохранённые компании</h2><p>Контакты останутся здесь после нового поиска и перезапуска.</p></div>
            <div className="saved-count"><b>{savedLeads.length}</b><span>в работе</span></div>
          </div>
          <div className="maps-result-actions"><span>Можно позвонить или написать позже — список хранится на этом компьютере.</span><div className="maps-action-buttons"><button className="btn btn-secondary" onClick={() => downloadCsv(savedLeads, 'saved')} disabled={!savedLeads.length}>Скачать сохранённые</button><button className="btn btn-secondary maps-clear-button" onClick={removeAllSavedCompanies} disabled={!savedLeads.length}>Убрать всё</button></div></div>
          <div className="telegram-table-wrap"><table><thead><tr><th>Компания</th><th>Телефон</th><th>Соцсети</th><th>Сайт</th><th>Написал</th><th>Сохранено</th><th></th></tr></thead><tbody>
            {savedLeads.map((lead) => <tr key={`${lead.platform}:${lead.sourceUrl}`}>
              <td><a href={lead.sourceUrl} target="_blank" rel="noreferrer">{lead.name || 'Без названия'}</a><small className="maps-category">{lead.platform === 'yandex_maps' ? 'Яндекс Карты' : lead.platform === 'two_gis_maps' ? '2ГИС' : 'Google Карты'} · {lead.address || 'Адрес не указан'}</small></td>
              <td>{lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : '—'}</td>
              <td><div className="maps-socials">{lead.socialLinks?.length ? lead.socialLinks.map((social) => <a key={social.url} href={social.url} target="_blank" rel="noreferrer">{social.platform}</a>) : <span className="maps-missing">Не найдены</span>}</div></td>
              <td>{lead.website ? <a href={lead.website} target="_blank" rel="noreferrer">Открыть сайт</a> : <span className="maps-missing">Нет сайта</span>}</td>
              <td><label className={`maps-contact-check ${lead.contactedAt ? 'contacted' : ''}`}><input type="checkbox" checked={Boolean(lead.contactedAt)} onChange={() => toggleContacted(lead)} disabled={contactUpdating.has(`${lead.platform}:${lead.sourceUrl}`)} /><span>{lead.contactedAt ? 'Написал' : 'Не написал'}</span></label></td>
              <td>{lead.savedAt ? new Date(lead.savedAt).toLocaleDateString('ru-RU') : 'Сегодня'}</td>
              <td><button className="maps-remove-button" onClick={() => removeSavedCompany(lead)}>Убрать</button></td>
            </tr>)}
            {!savedLeads.length ? <tr><td colSpan={7} className="telegram-empty">Сохраните нужные компании из результатов — они появятся здесь.</td></tr> : null}
          </tbody></table></div>
        </section>
      </main>
    </div>
  );
}

export function ParserGoogleMaps() {
  return <MapsParser provider="google" />;
}
