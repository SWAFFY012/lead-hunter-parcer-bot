import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../services/socket';

interface Log {
  id: number;
  time: string;
  msg: string;
  type: 'info' | 'warn' | 'error' | 'message';
}

export function Warmup() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [minDelay, setMinDelay] = useState(100);
  const [maxDelay, setMaxDelay] = useState(250);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchStatus();
    fetchSettings();
    fetchLogs();

    const handleLog = (data: { message: string, type: any }) => {
      addLog(data.message, data.type || 'info');
    };
    
    const handleMsg = (data: { from: string, to: string, message: string }) => {
      addLog(`[${data.from}] ➜ [${data.to}] ${data.message}`, 'message');
    };

    const handleStatus = (data: { running: boolean }) => {
      setIsRunning(data.running);
    };

    socket.on('warmup:log', handleLog);
    socket.on('warmup:message', handleMsg);
    socket.on('warmup:status', handleStatus);

    return () => {
      socket.off('warmup:log', handleLog);
      socket.off('warmup:message', handleMsg);
      socket.off('warmup:status', handleStatus);
    };
  }, []);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const addLog = (msg: string, type: Log['type']) => {
    setLogs(prev => {
      const newLogs = [...prev, { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), msg, type }];
      if (newLogs.length > 100) return newLogs.slice(newLogs.length - 100);
      return newLogs;
    });
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch(`/api/warmup/logs?limit=50`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const history: Log[] = data.reverse().map((l: any) => ({
          id: l.id,
          time: new Date(l.sent_at).toLocaleTimeString(),
          msg: `[${l.from_account}] ➜ [${l.to_account}] ${l.message}`,
          type: 'message'
        }));
        setLogs(history);
      }
    } catch (e) {}
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/warmup/status`);
      const data = await res.json();
      setIsRunning(data.running);
    } catch (e) {}
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(`/api/settings`);
      const data = await res.json();
      if (data.warmup_min_delay_sec) setMinDelay(Number(data.warmup_min_delay_sec));
      if (data.warmup_max_delay_sec) setMaxDelay(Number(data.warmup_max_delay_sec));
    } catch (e) {}
  };

  const saveSettings = async () => {
    try {
      await fetch(`/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          warmup_min_delay_sec: String(minDelay),
          warmup_max_delay_sec: String(maxDelay)
        })
      });
      alert('Настройки сохранены');
    } catch (e) {}
  };

  const toggleWarmup = async () => {
    const endpoint = isRunning ? 'stop' : 'start';
    try {
      await fetch(`/api/warmup/${endpoint}`, { method: 'POST' });
      setIsRunning(!isRunning);
    } catch (e) {}
  };

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <h1 className="page-title">Прогрев Аккаунтов</h1>
          <div className="text-secondary mt-1">Имитация живого общения между аккаунтами</div>
        </div>
      </div>

      <div className="page-body">
        <div className="grid-2" style={{ height: 'calc(100vh - 120px)' }}>
          
          {/* Settings */}
          <div className="card" style={{ height: 'fit-content' }}>
            <span className="card-title">Настройки алгоритма</span>
            <div className="flex flex-col gap-4 mt-4">
              <div>
                <label className="form-label">Лимит сообщений в день</label>
                <div className="form-input text-secondary" style={{ backgroundColor: '#F9FAFB' }}>
                  Динамический: от 3-10 до 50-70 (за 7 дней)
                </div>
              </div>
              <div>
                <label className="form-label">Длительность паузы (секунды)</label>
                <div className="flex gap-2 items-center">
                  <input type="number" className="form-input w-full" value={minDelay} onChange={e => setMinDelay(Number(e.target.value))} />
                  <span className="text-secondary">—</span>
                  <input type="number" className="form-input w-full" value={maxDelay} onChange={e => setMaxDelay(Number(e.target.value))} />
                </div>
              </div>
              <button className="btn btn-secondary w-full" onClick={saveSettings}>Сохранить настройки</button>
              
              <hr style={{ border: 'none', borderTop: '1px solid var(--color-border-weak)', margin: '8px 0' }} />
              
              <button 
                className={`btn w-full justify-center ${isRunning ? 'btn-ghost' : 'btn-primary'}`} 
                style={{ padding: '12px', fontSize: '15px', backgroundColor: isRunning ? '#EF4444' : '', color: isRunning ? 'white' : '' }}
                onClick={toggleWarmup}
              >
                {isRunning ? '⏹ Остановить прогрев' : '🔥 Запустить прогрев'}
              </button>
            </div>
          </div>

          {/* Live Logs */}
          <div className="card flex flex-col h-full" style={{ overflow: 'hidden' }}>
            <div className="flex justify-between items-center mb-4">
              <span className="card-title" style={{ margin: 0 }}>Журнал в реальном времени</span>
              {isRunning ? (
                <span className="badge badge-online">работает</span>
              ) : (
                <span className="badge badge-new">остановлен</span>
              )}
            </div>
            
            <div className="flex-1 flex flex-col gap-3 p-4 rounded-xl" style={{ backgroundColor: '#111827', color: '#9CA3AF', fontFamily: 'var(--font-family-mono)', overflowY: 'auto' }}>
              {logs.map(log => (
                <div key={log.id} className="flex gap-3 text-sm">
                  <span style={{ color: '#4B5563', flexShrink: 0 }}>{log.time}</span>
                  <span style={{ 
                    color: log.type === 'message' ? '#60A5FA' : log.type === 'warn' ? '#FBBF24' : log.type === 'error' ? '#EF4444' : '#9CA3AF' 
                  }}>
                    {log.msg}
                  </span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
