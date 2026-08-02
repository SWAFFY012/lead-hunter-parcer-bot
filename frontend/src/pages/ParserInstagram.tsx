import React, { useState, useEffect } from 'react';
import { socket } from '../services/socket';

interface ParsedLead {
  id?: number;
  phone: string;
  name?: string;
  title?: string;
  time?: string;
  platform?: string;
}

interface Profile {
  id: string;
  name: string;
  webgl_renderer: string;
  session_path: string | null;
}

export function ParserInstagram() {
  const [url, setUrl] = useState(() => localStorage.getItem('ig_url') || '');
  const [pages, setPages] = useState(() => Number(localStorage.getItem('ig_pages')) || 3);
  const platform = 'instagram';
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentAccount: 0, totalAccounts: 0, status: 'idle' });
  const [leads, setLeads] = useState<ParsedLead[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => localStorage.getItem('ig_profileId') || '');

  const [filterGeo, setFilterGeo] = useState(() => localStorage.getItem('ig_filterGeo') === 'true');
  const [filterActive, setFilterActive] = useState(() => localStorage.getItem('ig_filterActive') === 'true');
  const [minFollowers, setMinFollowers] = useState(() => { const v = localStorage.getItem('ig_minFollowers'); return v !== null ? Number(v) : 50; });
  const [maxFollowers, setMaxFollowers] = useState(() => { const v = localStorage.getItem('ig_maxFollowers'); return v !== null ? Number(v) : 20000; });
  const [maxPostDays, setMaxPostDays] = useState(() => Number(localStorage.getItem('ig_maxPostDays')) || 0);
  const [takeScreenshots, setTakeScreenshots] = useState(() => localStorage.getItem('ig_takeScreenshots') === 'true');

  const [campaigns, setCampaigns] = useState<{id: number, name: string}[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | ''>(() => {
    const saved = localStorage.getItem('ig_campaignId');
    return saved ? Number(saved) : '';
  });
  const [isSessionActive, setIsSessionActive] = useState<boolean | null>(null);
  
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    localStorage.setItem('ig_url', url);
    localStorage.setItem('ig_pages', String(pages));
    localStorage.setItem('ig_filterGeo', String(filterGeo));
    localStorage.setItem('ig_filterActive', String(filterActive));
    localStorage.setItem('ig_minFollowers', String(minFollowers));
    localStorage.setItem('ig_maxFollowers', String(maxFollowers));
    localStorage.setItem('ig_maxPostDays', String(maxPostDays));
    localStorage.setItem('ig_takeScreenshots', String(takeScreenshots));
    localStorage.setItem('ig_profileId', selectedProfileId);
    if (selectedCampaignId) {
      localStorage.setItem('ig_campaignId', String(selectedCampaignId));
    } else {
      localStorage.removeItem('ig_campaignId');
    }
  }, [url, pages, filterGeo, filterActive, minFollowers, maxFollowers, maxPostDays, takeScreenshots, selectedProfileId, selectedCampaignId]);

  const fetchTasks = () => {
    fetch(`/api/parser/tasks`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setTasks(data.filter((t: any) => t.platform === 'instagram')); })
      .catch(console.error);
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  useEffect(() => {
    fetch(`/api/campaigns`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setCampaigns(data); })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedProfileId) {
      setIsSessionActive(null);
      return;
    }
    fetch(`/api/parser/instagram/check-session/${selectedProfileId}`)
      .then(r => r.json())
      .then(data => setIsSessionActive(data.active))
      .catch(() => setIsSessionActive(false));
  }, [selectedProfileId]);

  useEffect(() => {
    const handleStarted = (data: { platform: string }) => {
      if (data.platform !== platform) return;
      setLoading(true);
      setLeads([]);
      setLogs(['Парсер запущен...']);
      setProgress({ current: 0, total: 0, currentAccount: 0, totalAccounts: 0, status: 'running' });
    };

    const handleProgress = (data: { currentPage: number, totalPages: number, currentAccount?: number, totalAccounts?: number }) => {
      setProgress({ 
        current: data.currentPage, 
        total: data.totalPages, 
        currentAccount: data.currentAccount || 0,
        totalAccounts: data.totalAccounts || 0,
        status: 'running' 
      });
    };

    const handleLead = (data: { lead: ParsedLead }) => {
      if (data.lead.platform !== platform) return;
      setLeads(prev => [{ ...data.lead, time: new Date().toLocaleTimeString() }, ...prev]);
    };

    const handleLog = (data: { message: string, type: string }) => {
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${data.message}`, ...prev].slice(0, 500));
    };

    const handleDone = () => {
      setLoading(false);
      setProgress(prev => ({ ...prev, status: 'idle' }));
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] Парсинг завершен!`, ...prev]);
    };

    socket.on('parser:started', handleStarted);
    socket.on('parser:progress', handleProgress);
    socket.on('parser:lead', handleLead);
    socket.on('parser:log', handleLog);
    socket.on('parser:done', handleDone);

    fetch(`/api/parser/status`)
      .then(r => r.json())
      .then(res => {
        if (res.isRunning && res.platform === platform) {
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
    };
  }, []);

  useEffect(() => {
    fetch(`/api/profiles`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setProfiles(data); })
      .catch(console.error);
  }, []);

  const handleStart = async () => {
    try {
      await fetch(`/api/parser/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          url: url.trim(), 
          pages, 
          profile_id: selectedProfileId || undefined, 
          campaign_id: selectedCampaignId || undefined,
          platform, 
          filterGeo, 
          filterActive,
          minFollowers,
          maxFollowers,
          maxPostDays,
          takeScreenshots
        })
      });
      setTimeout(fetchTasks, 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleContinueTask = async (task: any) => {
    const newPages = task.pages + 3;
    setUrl(task.url);
    setPages(newPages);
    if (task.campaign_id) setSelectedCampaignId(task.campaign_id);
    if (task.profile_id) setSelectedProfileId(task.profile_id);
    
    let parsedFilters: any = {};
    try {
      parsedFilters = JSON.parse(task.filters || '{}');
      if (parsedFilters.minFollowers !== undefined) setMinFollowers(parsedFilters.minFollowers);
      if (parsedFilters.maxFollowers !== undefined) setMaxFollowers(parsedFilters.maxFollowers);
      if (parsedFilters.filterGeo !== undefined) setFilterGeo(parsedFilters.filterGeo);
      if (parsedFilters.filterActive !== undefined) setFilterActive(parsedFilters.filterActive);
      if (parsedFilters.takeScreenshots !== undefined) setTakeScreenshots(parsedFilters.takeScreenshots);
      if (parsedFilters.maxPostDays !== undefined) setMaxPostDays(parsedFilters.maxPostDays);
    } catch(e) {}
    
    try {
      await fetch(`/api/parser/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: task.url,
          pages: newPages,
          profile_id: task.profile_id || undefined,
          campaign_id: task.campaign_id || undefined,
          platform,
          taskId: task.id,
          ...parsedFilters
        })
      });
      setTimeout(fetchTasks, 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!window.confirm('Удалить задачу из истории?')) return;
    try {
      await fetch(`/api/parser/tasks/${taskId}`, { method: 'DELETE' });
      fetchTasks();
    } catch (err) { console.error(err); }
  };

  const handleStop = async () => {
    try {
      await fetch(`/api/parser/stop`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform })
      });
      setLoading(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAuth = async () => {
    if (!selectedProfileId) {
      alert('Сначала выберите браузерный профиль для авторизации!');
      return;
    }
    try {
      await fetch(`/api/parser/instagram-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: selectedProfileId })
      });
      alert('Окно браузера открыто. Авторизуйтесь в Инстаграме и закройте браузер.');
    } catch (err) {
      console.error(err);
    }
  };

  let progressPercent = 0;
  if (progress.total > 0) {
    if (progress.totalAccounts > 0) {
      progressPercent = Math.round((progress.currentAccount / progress.totalAccounts) * 100);
    } else {
      progressPercent = Math.round((progress.current / progress.total) * 100);
    }
  }

  const renderLogText = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.split(urlRegex).map((part, i) => {
      if (part.match(urlRegex)) {
        return <a key={i} href={part} target="_blank" rel="noreferrer" style={{ color: '#60A5FA', textDecoration: 'underline' }}>{part}</a>;
      }
      return part;
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="page-header flex justify-between items-center">
        <div>
          <h1 className="page-title">Парсинг Instagram</h1>
          <div className="text-secondary mt-1">Автоматический сбор лидов по хэштегам или гео</div>
        </div>
        <div>
          <button className="btn btn-secondary" onClick={handleAuth}>🔑 Авторизация Instagram</button>
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
                <label className="form-label flex items-center justify-between">
                  <span>Браузерный профиль</span>
                  {selectedProfileId && (
                    <span style={{ fontSize: '12px', fontWeight: 500, color: isSessionActive === null ? '#6B7280' : isSessionActive ? '#10B981' : '#EF4444' }}>
                      {isSessionActive === null ? '⏳ Проверка...' : isSessionActive ? '🟢 Подключен к Instagram' : '🔴 Требуется авторизация'}
                    </span>
                  )}
                </label>
                <select className="form-input" value={selectedProfileId} onChange={e => setSelectedProfileId(e.target.value)} disabled={loading}>
                  <option value="">Случайный (анонимный)</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">База данных (Кампания) для сохранения</label>
                <select className="form-input" value={selectedCampaignId} onChange={e => setSelectedCampaignId(Number(e.target.value) || '')} disabled={loading}>
                  <option value="">Без базы (просто в общий список)</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Ссылка на хэштег / Поиск</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="https://www.instagram.com/explore/tags/targetolog/"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="flex flex-col gap-2 p-4" style={{ backgroundColor: '#EEF2FF', borderRadius: '8px' }}>
                <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: '14px', fontWeight: 500, color: '#374151' }}>
                  <input type="checkbox" checked={filterGeo} onChange={e => setFilterGeo(e.target.checked)} disabled={loading} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                  Только из Украины (Bio содержит геометки ИЛИ украинские буквы: ї, і, є, ґ)
                </label>
                <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: '14px', fontWeight: 500, color: '#374151' }}>
                  <input type="checkbox" checked={filterActive} onChange={e => setFilterActive(e.target.checked)} disabled={loading} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                  Только активные (наличие выложенных Stories за 24 часа)
                </label>
                
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <label className="form-label text-xs">Мин. подписчиков</label>
                    <input type="number" className="form-input" value={minFollowers} onChange={e => setMinFollowers(Number(e.target.value))} disabled={loading} />
                  </div>
                  <div>
                    <label className="form-label text-xs">Макс. подписчиков</label>
                    <input type="number" className="form-input" value={maxFollowers} onChange={e => setMaxFollowers(Number(e.target.value))} disabled={loading} />
                  </div>
                </div>

                <div className="mt-2">
                  <label className="form-label text-xs" title="Если нет Stories, парсер проверит дату первого поста. Укажите 0, чтобы не проверять.">
                    Проверять дату первого поста (макс. дней назад)
                  </label>
                  <input type="number" className="form-input" value={maxPostDays} onChange={e => setMaxPostDays(Number(e.target.value))} disabled={loading} placeholder="Например: 90" />
                </div>
              </div>

              <div>
                <label className="form-label">Количество прокруток ленты (скроллов)</label>
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
                  <button className="btn btn-primary w-full justify-center" onClick={handleStart} style={{ height: '44px', background: '#e1306c', border: 'none' }}>📸 Начать сбор Instagram</button>
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
                {progress.totalAccounts > 0 
                  ? `Аккаунт ${progress.currentAccount} из ${progress.totalAccounts}`
                  : `Страница ${progress.current} из ${progress.total}`
                }
              </div>
            )}
          </div>

          <div style={{ height: '8px', width: '100%', backgroundColor: '#EEF2FF', borderRadius: '4px', overflow: 'hidden', marginBottom: '24px' }}>
            <div style={{ width: `${progressPercent}%`, height: '100%', backgroundColor: 'var(--color-primary)', borderRadius: '4px', transition: 'width 0.3s' }} />
          </div>
          
          {tasks.length > 0 && (
            <div className="card p-6 mb-6">
              <h2 className="card-title text-sm mb-4">Сохраненные задачи парсинга</h2>
              <div className="flex flex-col gap-3">
                {tasks.map(task => (
                  <div key={task.id} className="flex justify-between items-center p-3 rounded-lg border border-gray-100 bg-gray-50">
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="font-medium text-sm break-all" style={{ color: '#111827' }}>
                        <a href={task.url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">🔗 Открыть ссылку</a>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Кампания: {task.campaign_name || 'Без кампании'} • Лидов: {task.total_leads} • Просмотрено: {task.visited_count} постов
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button 
                        className="btn btn-primary text-xs shrink-0" 
                        style={{ padding: '6px 12px' }}
                        onClick={() => handleContinueTask(task)}
                        disabled={loading}
                      >
                        ▶️ Продолжить
                      </button>
                      <button 
                        className="btn btn-secondary text-xs" 
                        style={{ padding: '6px 10px', color: '#EF4444' }}
                        onClick={() => handleDeleteTask(task.id)}
                        disabled={loading}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card p-6">
            <div className="table-container" style={{ flex: 2 }}>
              <table style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Имя / Имя пользователя</th>
                    <th>Описание профиля</th>
                    <th>Найдено</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead, i) => (
                    <tr key={i}>
                      <td>
                        <div style={{ fontWeight: 500, color: '#111827' }}>{lead.name || 'Без имени'}</div>
                        <div className="text-xs text-secondary">{lead.phone}</div>
                      </td>
                      <td><div style={{ color: '#374151', maxWidth: '350px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.title}</div></td>
                      <td><span className="text-xs text-secondary">{lead.time}</span></td>
                    </tr>
                  ))}
                  {leads.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-center text-secondary py-8">
                        {loading ? 'Ищем лиды...' : 'Нет собранных лидов'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

              <div className="flex flex-col gap-2 p-4 rounded-xl relative mt-6" style={{ backgroundColor: '#111827', color: '#9CA3AF', fontFamily: 'var(--font-family-mono)', height: '400px', overflowY: 'auto' }}>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-4">
                    <div className="text-xs" style={{ color: '#4B5563' }}>СИСТЕМНЫЙ ЖУРНАЛ</div>
                    <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: '13px', color: '#9CA3AF' }}>
                      <input type="checkbox" checked={takeScreenshots} onChange={e => setTakeScreenshots(e.target.checked)} disabled={loading} style={{ width: '14px', height: '14px', cursor: 'pointer' }} />
                      Делать скриншоты ошибок (debug)
                    </label>
                  </div>
                  <button 
                    className="btn btn-secondary text-xs" 
                    style={{ padding: '4px 8px', minHeight: 'auto', backgroundColor: '#374151', color: '#FFF', border: 'none' }}
                    onClick={() => navigator.clipboard.writeText(logs.join('\n'))}
                  >
                    Скопировать логи
                  </button>
                </div>
                {logs.map((log, i) => (
                  <div key={i} className="text-sm">{renderLogText(log)}</div>
                ))}
                {logs.length === 0 && <div className="text-sm text-secondary">Ждем запуска парсера...</div>}
              </div>
          </div>
        </div>

      </div>
    </div>
  );
}
