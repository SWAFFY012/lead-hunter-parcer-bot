import React, { useState, useEffect } from 'react';
import { socket } from '../services/socket';

interface ParsedLead {
  id?: number;
  phone: string;
  name?: string;
  title?: string;
  time?: string;
}

interface Profile {
  id: string;
  name: string;
  webgl_renderer: string;
  session_path: string | null;
}

export function ParserOlx() {
  const [url, setUrl] = useState('');
  const [pages, setPages] = useState(3);
  const platform = 'olx';
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: 'idle' });
  const [leads, setLeads] = useState<ParsedLead[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  
  // Modal state
  const [isCookieModalOpen, setIsCookieModalOpen] = useState(false);
  const [cookieJson, setCookieJson] = useState('');
  const [userAgent, setUserAgent] = useState('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  useEffect(() => {
    const handleStarted = () => {
      setLoading(true);
      setLeads([]);
      setLogs(['Парсер запущен...']);
      setProgress({ current: 0, total: 0, status: 'running' });
    };

    const handleProgress = (data: { currentPage: number, totalPages: number }) => {
      setProgress({ current: data.currentPage, total: data.totalPages, status: 'running' });
    };

    const handleLead = (data: { lead: ParsedLead }) => {
      setLeads(prev => [{ ...data.lead, time: new Date().toLocaleTimeString() }, ...prev]);
    };

    const handleLog = (data: { message: string, type: string }) => {
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${data.message}`, ...prev].slice(0, 50));
    };

    const handleDone = () => {
      setLoading(false);
      setProgress(prev => ({ ...prev, status: 'idle' }));
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] Парсинг завершен!`, ...prev]);
    };

    const handleAuth = (data: { message: string, status?: string }) => {
      setAuthStatus(data.message);
      if (data.status === 'done' || data.status === 'error') {
        setTimeout(() => setAuthStatus(null), 5000);
      }
    };

    socket.on('parser:started', handleStarted);
    socket.on('parser:progress', handleProgress);
    socket.on('parser:lead', handleLead);
    socket.on('parser:log', handleLog);
    socket.on('parser:done', handleDone);
    socket.on('parser:auth', handleAuth);

    // Initial status check
    fetch(`http://${window.location.hostname}:3001/api/parser/status`)
      .then(r => r.json())
      .then(res => {
        if (res.isRunning) {
          setLoading(true);
        }
      })
      .catch(console.error);

    return () => {
      socket.off('parser:started', handleStarted);
      socket.off('parser:progress', handleProgress);
      socket.off('parser:lead', handleLead);
      socket.off('parser:log', handleLog);
      socket.off('parser:done', handleDone);
      socket.off('parser:auth', handleAuth);
    };
  }, []);

  // Load profiles
  useEffect(() => {
    fetch(`http://${window.location.hostname}:3001/api/profiles`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setProfiles(data); })
      .catch(console.error);
  }, []);

  const handleStart = async () => {
    try {
      let cleanUrl = url.trim();
      if ((cleanUrl.match(/https?:\/\//g) || []).length > 1) {
        alert('Ошибка: Неверный формат ссылки. В ссылке несколько "http". Убедитесь, что вы скопировали ровно одну ссылку.');
        return;
      }
      
      await fetch(`http://${window.location.hostname}:3001/api/parser/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl, pages, profile_id: selectedProfileId || undefined, platform })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleStop = async () => {
    try {
      await fetch(`http://${window.location.hostname}:3001/api/parser/stop`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform })
      });
      setLoading(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAuthOlx = async () => {
    try {
      await fetch(`http://${window.location.hostname}:3001/api/parser/auth-olx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: selectedProfileId || undefined })
      });
      setAuthStatus('Запуск браузера для авторизации...');
    } catch (err) {
      console.error(err);
    }
  };

  const handleAuthConfirm = async () => {
    try {
      await fetch(`http://${window.location.hostname}:3001/api/parser/auth-olx-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: selectedProfileId || undefined })
      });
      setAuthStatus('Сохранение сессии...');
    } catch (err) {
      console.error(err);
    }
  };

  const handleAuthCancel = async () => {
    try {
      await fetch(`http://${window.location.hostname}:3001/api/parser/auth-olx-cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: selectedProfileId || undefined })
      });
      setAuthStatus('Отмена...');
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenCookieModal = async () => {
    try {
      const q = selectedProfileId ? `?profileId=${selectedProfileId}` : '';
      const res = await fetch(`http://${window.location.hostname}:3001/api/parser/cookies${q}`);
      if (res.ok) {
        const cookies = await res.json();
        if (cookies && cookies.length > 0) {
          setCookieJson(JSON.stringify(cookies, null, 2));
        } else {
          setCookieJson('');
        }
      }
    } catch (err) {
      console.error(err);
    }
    setIsCookieModalOpen(true);
  };

  const handleImportCookies = async () => {
    try {
      let cookies;
      try {
        cookies = JSON.parse(cookieJson);
      } catch (e) {
        alert('Ошибка: Неверный формат JSON');
        return;
      }
      
      const res = await fetch(`http://${window.location.hostname}:3001/api/parser/import-cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: selectedProfileId || undefined, cookies, userAgent })
      });
      
      if (!res.ok) {
        const data = await res.json();
        alert('Ошибка импорта: ' + data.error);
        return;
      }
      
      setAuthStatus('Куки успешно импортированы!');
      setIsCookieModalOpen(false);
      setCookieJson('');
    } catch (err) {
      console.error(err);
      alert('Ошибка при импорте кук');
    }
  };

  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <h1 className="page-title">Парсинг OLX</h1>
          <div className="text-secondary mt-1">Автоматический сбор лидов по ссылке</div>
        </div>
        <div className="flex gap-2 items-center">
          {profiles.length > 0 && (
            <select
              className="form-input"
              style={{ width: '180px', height: '38px', fontSize: '13px' }}
              value={selectedProfileId}
              onChange={e => setSelectedProfileId(e.target.value)}
            >
              <option value="">Без профиля</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.session_path ? '✓' : '⚠️'}
                </option>
              ))}
            </select>
          )}
          {authStatus && <span className="text-sm font-medium" style={{ color: 'var(--color-warning)' }}>{authStatus}</span>}
          {authStatus?.includes('Окно открыто') || authStatus?.includes('Запуск') ? (
            <div className="flex gap-2">
              <button className="btn btn-ghost" style={{ color: 'var(--color-error)' }} onClick={handleAuthCancel}>Отмена</button>
              <button className="btn btn-primary" onClick={handleAuthConfirm} disabled={!authStatus?.includes('Окно открыто')}>Я вошел в аккаунт</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={handleAuthOlx}>🔑 Авторизовать OLX</button>
              <button className="btn btn-ghost" onClick={handleOpenCookieModal}>🍪 Импорт кук</button>
            </div>
          )}
        </div>
      </div>

      <div className="page-body flex flex-col gap-6">
        
        {/* Settings */}
          <div className="card h-fit" style={{ padding: '24px' }}>
            <div className="flex justify-between items-center mb-6">
              <span className="card-title" style={{ margin: 0 }}>Настройки парсера</span>
            </div>
            
            <div className="flex flex-col gap-4">
              <div>
                <label className="form-label">Браузерный профиль</label>
                <select className="form-input" value={selectedProfileId} onChange={e => setSelectedProfileId(e.target.value)} disabled={loading}>
                  <option value="">Случайный (анонимный)</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Ссылка на раздел / Поиск</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div>
                <label className="form-label">Глубина парсинга (страниц/прокруток)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={pages}
                  onChange={e => setPages(Number(e.target.value))}
                  disabled={loading}
                />
              </div>

              <div className="mt-2">
                {!loading ? (
                  <button className="btn btn-primary w-full justify-center" onClick={handleStart} style={{ height: '44px' }}>🕷️ Начать сбор</button>
                ) : (
                  <button className="btn btn-secondary w-full justify-center" onClick={handleStop} style={{ height: '44px', color: 'var(--color-error)' }}>⏹ Остановить парсер</button>
                )}
              </div>
            </div>
          </div>

        {/* Progress and Results */}
        <div className="card">
          <div className="flex justify-between items-end mb-4">
            <span className="card-title" style={{ margin: 0 }}>Результаты парсинга</span>
            {progress.total > 0 && (
              <div className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                Страница {progress.current} из {progress.total}
              </div>
            )}
          </div>

          <div style={{ height: '8px', width: '100%', backgroundColor: '#EEF2FF', borderRadius: '4px', overflow: 'hidden', marginBottom: '24px' }}>
            <div style={{ width: `${progressPercent}%`, height: '100%', backgroundColor: 'var(--color-primary)', borderRadius: '4px', transition: 'width 0.3s' }} />
          </div>

          <div className="grid-2 gap-6">
            <div className="table-container" style={{ flex: 2 }}>
              <table style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Имя</th>
                    <th>Телефон</th>
                    <th>Заголовок</th>
                    <th>Найдено</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead, i) => (
                    <tr key={i}>
                      <td><div style={{ fontWeight: 500, color: '#111827' }}>{lead.name || 'Без имени'}</div></td>
                      <td><span className="mono">{lead.phone}</span></td>
                      <td><div style={{ color: '#374151', maxWidth: '250px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.title}</div></td>
                      <td><span className="text-xs text-secondary">{lead.time}</span></td>
                    </tr>
                  ))}
                  {leads.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-secondary py-8">
                        {loading ? 'Ищем лиды...' : 'Нет собранных лидов'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2 p-4 rounded-xl" style={{ backgroundColor: '#111827', color: '#9CA3AF', fontFamily: 'var(--font-family-mono)', height: '400px', overflowY: 'auto' }}>
              <div className="text-xs" style={{ color: '#4B5563', marginBottom: '8px' }}>СИСТЕМНЫЙ ЖУРНАЛ</div>
              {logs.map((log, i) => (
                <div key={i} className="text-sm">{log}</div>
              ))}
              {logs.length === 0 && <div className="text-sm text-secondary">Ждем запуска парсера...</div>}
            </div>
          </div>
        </div>

      </div>
      
      {/* Cookie Import Modal */}
      {isCookieModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="card" style={{ width: '600px', maxWidth: '90vw' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Импорт файлов cookie (EditThisCookie)</h2>
            <p className="text-secondary text-sm" style={{ marginBottom: '16px' }}>
              Вставьте JSON-массив кукисов, скопированный из расширения EditThisCookie. Это позволит парсеру авторизоваться в OLX без запуска браузера, минуя защиту DataDome.
            </p>
            <textarea 
              className="form-input" 
              style={{ width: '100%', height: '200px', fontFamily: 'monospace', fontSize: '12px', marginBottom: '16px' }}
              placeholder='[{"domain": ".olx.ua", "name": "...", "value": "..."}]'
              value={cookieJson}
              onChange={e => setCookieJson(e.target.value)}
            />
            <p className="text-secondary text-sm" style={{ marginBottom: '8px' }}>
              Ваш точный User-Agent (ОБЯЗАТЕЛЬНО должен совпадать с браузером):
            </p>
            <input 
              className="form-input" 
              style={{ width: '100%', marginBottom: '16px' }}
              placeholder="Mozilla/5.0..."
              value={userAgent}
              onChange={e => setUserAgent(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button className="btn btn-ghost" onClick={() => setIsCookieModalOpen(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={handleImportCookies} disabled={!cookieJson.trim()}>Импортировать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
