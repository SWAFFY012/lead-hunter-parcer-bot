import React, { useState, useEffect } from 'react';

interface StatsResponse {
  totals: {
    total: number;
    new_leads: number;
    ready_to_send: number;
    sent: number;
    invalid_number: number;
    failed: number;
    replied: number;
    interested: number;
    deals: number;
    refused: number;
  };
  todayStats: { sent_today: number };
  repliedToday: { replied_today: number };
  weekActivity: { day: string; sent: number; received: number }[];
}

const STATUS_LABELS: Record<string, { label: string, color: string }> = {
  new_leads: { label: 'Новые', color: 'var(--color-text-secondary)' },
  ready_to_send: { label: 'Готовы к отправке', color: 'var(--color-info)' },
  sent: { label: 'Отправлено', color: 'var(--color-info)' },
  invalid_number: { label: 'Нет в WA', color: 'var(--color-text-secondary)' },
  failed: { label: 'Ошибка', color: 'var(--color-error)' },
  replied: { label: 'Ответили', color: '#7C3AED' },
  interested: { label: 'Заинтересованы', color: 'var(--color-warning)' },
  deals: { label: 'Сделки', color: 'var(--color-success)' },
  refused: { label: 'Отказы', color: 'var(--color-error)' },
};

export function Dashboard() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`http://${window.location.hostname}:3001/api/leads/stats/dashboard`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(e => {
        console.error(e);
        setLoading(false);
      });
  }, []);

  if (loading || !data) {
    return <div className="p-8 text-secondary">Загрузка аналитики...</div>;
  }

  const { totals, todayStats, repliedToday, weekActivity } = data;

  const sentToday = todayStats?.sent_today || 0;
  const repliedTdy = repliedToday?.replied_today || 0;
  const totalLeads = totals?.total || 0;

  // Calculate overall conversion
  const sentAllTime = totals?.sent || 0;
  const repliedAllTime = totals?.replied || 0;
  const conversion = sentAllTime > 0 ? ((repliedAllTime / sentAllTime) * 100).toFixed(1) : '0.0';

  const statuses = Object.entries(STATUS_LABELS).map(([k, v]) => {
    const count = totals[k as keyof typeof totals] || 0;
    const percent = totalLeads > 0 ? ((count / totalLeads) * 100).toFixed(1) : 0;
    return { ...v, count, percent };
  });

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <div className="text-secondary" style={{ marginTop: '4px' }}>Обзор активности LeadHunter</div>
        </div>
      </div>

      <div className="page-body flex flex-col gap-4 h-full overflow-hidden" style={{ minHeight: 0 }}>
        
        {/* Top Stats */}
        <div className="grid-4 shrink-0">
          <div className="card py-4">
            <span className="card-title text-sm">Отправлено сегодня 📤</span>
            <div className="stat-value text-2xl mt-1">{sentToday}</div>
            <div className="text-secondary text-xs mt-1">сообщений</div>
          </div>
          <div className="card py-4">
            <span className="card-title text-sm">Ответили сегодня 💬</span>
            <div className="stat-value text-2xl mt-1" style={{ color: '#059669' }}>{repliedTdy}</div>
            <div className="text-secondary text-xs mt-1">лидов</div>
          </div>
          <div className="card py-4">
            <span className="card-title text-sm">Конверсия (All-time) 🚀</span>
            <div className="stat-value text-2xl mt-1" style={{ color: '#D97706' }}>{conversion}%</div>
            <div className="text-secondary text-xs mt-1">ответили / отправлено</div>
          </div>
          <div className="card py-4">
            <span className="card-title text-sm">Всего лидов 👥</span>
            <div className="stat-value text-2xl mt-1" style={{ color: '#111827' }}>{totalLeads}</div>
            <div className="text-secondary text-xs mt-1">в базе данных</div>
          </div>
        </div>

        {/* 2-Column Layout */}
        <div className="grid-2 min-h-0" style={{ flex: 1 }}>
          
          {/* Left Column: Activity Chart / List */}
          <div className="card flex flex-col min-h-0">
            <span className="card-title mb-3 shrink-0">Активность за 7 дней</span>
            <div className="flex flex-col gap-2 overflow-y-auto pr-2" style={{ flex: 1 }}>
              {weekActivity && weekActivity.length > 0 ? weekActivity.map((day, i) => (
                <div key={i} className="flex justify-between items-center p-3 border rounded-lg">
                  <div style={{ fontWeight: 500, fontSize: '14px' }}>{new Date(day.day).toLocaleDateString('ru-RU', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] text-secondary mb-0.5">Отправлено</span>
                      <span className="badge badge-info">{day.sent}</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] text-secondary mb-0.5">Получено</span>
                      <span className="badge badge-success">{day.received}</span>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="text-secondary text-sm">Нет активности за последние 7 дней.</div>
              )}
            </div>
          </div>

          {/* Right Column: Status Bars */}
          <div className="card flex flex-col min-h-0">
            <span className="card-title mb-3 shrink-0">Воронка лидов (Общая)</span>
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 overflow-y-auto pr-2" style={{ flex: 1, alignContent: 'start' }}>
              {statuses.map(stat => (
                <div key={stat.label}>
                  <div className="flex justify-between text-xs mb-1.5" style={{ fontWeight: 500, color: '#111827' }}>
                    <span className="truncate pr-2">{stat.label}</span>
                    <span className="shrink-0">{stat.count} ({stat.percent}%)</span>
                  </div>
                  <div style={{ height: '6px', width: '100%', backgroundColor: '#F3F4F6', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${stat.percent}%`, height: '100%', backgroundColor: stat.color, borderRadius: '3px' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
