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

export function ParserGoogleMaps() {
  const [url, setUrl] = useState(() => localStorage.getItem('gm_url') || '');
  const [pages, setPages] = useState(() => Number(localStorage.getItem('gm_pages')) || 3);
  const platform = 'google_maps';
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentAccount: 0, totalAccounts: 0, status: 'idle' });
  const [leads, setLeads] = useState<ParsedLead[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<{id: number, name: string}[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | ''>(() => {
    const saved = localStorage.getItem('gm_campaignId');
    return saved ? Number(saved) : '';
  });
  
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    localStorage.setItem('gm_url', url);
    localStorage.setItem('gm_pages', String(pages));
    if (selectedCampaignId) {
      localStorage.setItem('gm_campaignId', String(selectedCampaignId));
    } else {
      localStorage.removeItem('gm_campaignId');
    }
  }, [url, pages, selectedCampaignId]);

  const fetchTasks = () => {
    fetch(`http://${window.location.hostname}:3001/api/parser/tasks`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setTasks(data.filter((t: any) => t.platform === 'google_maps')); })
      .catch(console.error);
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  useEffect(() => {
    fetch(`http://${window.location.hostname}:3001/api/campaigns`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setCampaigns(data); })
      .catch(console.error);
  }, []);



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

    fetch(`http://${window.location.hostname}:3001/api/parser/status`)
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

  const handleStart = async () => {
    try {
      await fetch(`http://${window.location.hostname}:3001/api/parser/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          pages: Number(pages),
          campaign_id: selectedCampaignId || undefined,
          platform
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
    
    try {
      await fetch(`http://${window.location.hostname}:3001/api/parser/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: task.url,
          pages: newPages,
          campaign_id: task.campaign_id || undefined,
          platform,
          taskId: task.id
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
      await fetch(`http://${window.location.hostname}:3001/api/parser/tasks/${taskId}`, { method: 'DELETE' });
      fetchTasks();
    } catch (err) { console.error(err); }
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


  let progressPercent = 0;
  if (progress.total > 0) {
    progressPercent = Math.round((progress.current / progress.total) * 100);
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
          <h1 className="page-title">Парсинг Google Maps</h1>
          <div className="text-secondary mt-1">Автоматический сбор контактов компаний по ссылке на поиск Google Карт</div>
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
                <label className="form-label">База данных (Кампания) для сохранения</label>
                <select className="form-input" value={selectedCampaignId} onChange={e => setSelectedCampaignId(Number(e.target.value) || '')} disabled={loading}>
                  <option value="">Без базы (просто в общий список)</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Ссылка на результаты поиска Google Maps</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="https://www.google.com/maps/search/Рестораны+Киев/"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  disabled={loading}
                />
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
                  <button className="btn btn-primary w-full justify-center" onClick={handleStart} style={{ height: '44px', background: '#e1306c', border: 'none' }}>📸 Начать сбор Google Maps</button>
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
                    <th>Имя / Username</th>
                    <th>Описание профиля (Bio)</th>
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
                    <div className="text-xs" style={{ color: '#4B5563' }}>SYSTEM LOG</div>
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
