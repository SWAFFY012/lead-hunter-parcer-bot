import { useEffect, useState } from 'react';

type LogLevel = 'info' | 'warn' | 'error';
type LogModule = 'parser' | 'sender' | 'ai' | 'system';

interface SystemLog {
  id: number;
  module: LogModule;
  level: LogLevel;
  message: string;
  details?: string;
  created_at: string;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  warn: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
};

const MODULE_LABELS: Record<LogModule, string> = {
  parser: 'Парсер',
  sender: 'Рассылка',
  ai: 'Нейросеть',
  system: 'Система'
};

export function SystemLogs() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/system/logs`);
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = async () => {
    if (!confirm('Вы уверены, что хотите очистить весь журнал ошибок?')) return;
    try {
      await fetch(`http://${window.location.hostname}:3001/api/system/logs`, { method: 'DELETE' });
      setLogs([]);
    } catch (err) {
      alert('Ошибка при очистке журнала');
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Журнал ошибок</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            История системных сбоев и важных событий
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchLogs}
            className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            Обновить
          </button>
          <button
            onClick={clearLogs}
            className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
          >
            Очистить журнал
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500">Загрузка журнала...</div>
        ) : logs.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', textAlign: 'center' }}>
            <div style={{ width: '64px', height: '64px', backgroundColor: '#D1FAE5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#0F172A', margin: '0 0 8px 0' }}>Все системы работают нормально</h3>
            <p style={{ fontSize: '14px', color: '#64748B', margin: 0 }}>Журнал логов чист, ошибок не обнаружено.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Время
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Модуль
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Уровень
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Сообщение
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                      {new Date(log.created_at + 'Z').toLocaleString('ru-RU')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-slate-900 dark:text-white">
                        {MODULE_LABELS[log.module] || log.module}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${LEVEL_COLORS[log.level]}`}>
                        {log.level.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                      <div className="font-medium">{log.message}</div>
                      {log.details && (
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-500 font-mono bg-slate-50 dark:bg-slate-900/50 p-2 rounded">
                          {log.details}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
