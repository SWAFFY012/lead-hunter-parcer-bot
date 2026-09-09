import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, patch, del } from '../lib/api';

interface Task {
  id: number;
  lead_id: number;
  lead_name: string;
  lead_phone: string;
  company_name: string;
  type: 'call' | 'meeting';
  due_date: string;
  time_start: string | null;
  time_end: string | null;
  note: string | null;
  result: string | null;
  status: 'pending' | 'done' | 'cancelled';
  created_at: string;
  done_at: string | null;
}

interface LeadOption {
  id: number;
  name: string;
  phone: string;
}

const TYPE_MAP: Record<string, [string, string]> = {
  call: ['Связаться', '#3b82f6'],
  meeting: ['Встреча', '#f59e0b'],
};

const SLOT_MIN = 30;
const SLOTS_PER_DAY = (24 * 60) / SLOT_MIN; // 48

function pad(n: number) { return String(n).padStart(2, '0'); }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function slotTime(i: number) { const h = Math.floor(i * SLOT_MIN / 60); const m = (i * SLOT_MIN) % 60; return `${pad(h)}:${pad(m)}`; }
function addMinutes(hhmm: string, min: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + min;
  const nh = Math.floor(((total % 1440) + 1440) % 1440 / 60);
  const nm = ((total % 60) + 60) % 60;
  return `${pad(nh)}:${pad(nm)}`;
}
function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday=0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function normDate(s: string) { return s.slice(0, 10); }
function normTasks(rows: Task[]) { return rows.map(t => ({ ...t, due_date: normDate(t.due_date) })); }

export function Tasks() {
  const navigate = useNavigate();
  const [view, setView] = useState<'day' | 'week' | 'month'>('week');
  const [cursor, setCursor] = useState(new Date());
  const [taskList, setTaskList] = useState<Task[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [modalTask, setModalTask] = useState<Partial<Task> | null>(null);
  const [loading, setLoading] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);

  const range = useCallback((): [string, string] => {
    if (view === 'day') { const s = fmtDate(cursor); return [s, s]; }
    if (view === 'week') { const s = startOfWeek(cursor); const e = new Date(s); e.setDate(e.getDate() + 6); return [fmtDate(s), fmtDate(e)]; }
    const s = startOfMonth(cursor);
    const e = new Date(s.getFullYear(), s.getMonth() + 1, 0);
    const gridStart = startOfWeek(s);
    const gridEnd = new Date(e); gridEnd.setDate(gridEnd.getDate() + ((7 - ((e.getDay() + 6) % 7) - 1) % 7));
    return [fmtDate(gridStart), fmtDate(gridEnd)];
  }, [view, cursor]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const [date_from, date_to] = range();
      const rows = await get<Task[]>(`/tasks/?date_from=${date_from}&date_to=${date_to}`);
      setTaskList(normTasks(rows));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [range]);

  const fetchOverdue = useCallback(async () => {
    try {
      const todayStr = fmtDate(new Date());
      const rows = normTasks(await get<Task[]>(`/tasks/?date_to=${todayStr}`));
      const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
      const count = rows.filter(t => {
        if (t.status !== 'pending') return false;
        if (t.due_date < todayStr) return true;
        const [h, m] = (t.time_end || t.time_start || '23:59').split(':').map(Number);
        return h * 60 + m <= nowMinutes;
      }).length;
      setOverdueCount(count);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => { fetchTasks(); fetchOverdue(); }, [fetchTasks, fetchOverdue]);
  useEffect(() => {
    get<{ leads: LeadOption[] }>('/leads?limit=100000').then(d => setLeads(d.leads || [])).catch(() => {});
  }, []);

  const shift = (delta: number) => {
    const d = new Date(cursor);
    if (view === 'day') d.setDate(d.getDate() + delta);
    else if (view === 'week') d.setDate(d.getDate() + delta * 7);
    else d.setMonth(d.getMonth() + delta);
    setCursor(d);
  };

  const openNewTask = (date: string, time?: string) => {
    setModalTask({ type: 'call', due_date: date, time_start: time || '', time_end: time ? addMinutes(time, SLOT_MIN) : '' });
  };

  const saveTask = async (t: Partial<Task>) => {
    try {
      if (t.id) {
        await patch(`/tasks/${t.id}`, t);
      } else {
        await post('/tasks/', t);
      }
      setModalTask(null);
      fetchTasks();
      fetchOverdue();
    } catch (err: any) {
      alert(`Ошибка: ${err.message}`);
    }
  };

  const deleteTask = async (id: number) => {
    if (!window.confirm('Удалить задачу?')) return;
    await del(`/tasks/${id}`);
    setModalTask(null);
    fetchTasks();
    fetchOverdue();
  };

  const title = view === 'day'
    ? cursor.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : view === 'week'
    ? (() => { const s = startOfWeek(cursor); const e = new Date(s); e.setDate(e.getDate() + 6); return `${s.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${e.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`; })()
    : cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <h1>Задачи</h1>
            {overdueCount > 0 && (
              <span style={{
                fontSize: 'var(--text-xs)', fontWeight: 700, color: '#fff', backgroundColor: '#dc2626',
                borderRadius: '10px', padding: '2px 9px',
              }}>
                ⚠ Просрочено: {overdueCount}
              </span>
            )}
          </div>
          <div className="text-sm text-secondary" style={{ marginTop: '4px', textTransform: 'capitalize' }}>{title}</div>
        </div>
        <div className="flex gap-2 items-center">
          <button className="btn btn-ghost" onClick={() => shift(-1)}>←</button>
          <button className="btn btn-secondary" onClick={() => setCursor(new Date())}>Сегодня</button>
          <button className="btn btn-ghost" onClick={() => shift(1)}>→</button>
          <div className="flex gap-1" style={{ marginLeft: '12px' }}>
            {(['day', 'week', 'month'] as const).map(v => (
              <button key={v} className={`btn ${view === v ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView(v)}>
                {v === 'day' ? 'День' : v === 'week' ? 'Неделя' : 'Месяц'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="page-body" style={{ overflow: 'auto' }}>
        {view === 'month' ? (
          <MonthGrid cursor={cursor} tasks={taskList} onDayClick={(d) => { setCursor(new Date(d)); setView('day'); }} onTaskClick={(t) => navigate(`/leads?lead_id=${t.lead_id}`)} />
        ) : (
          <TimeGrid view={view} cursor={cursor} tasks={taskList} onSlotClick={openNewTask} onTaskClick={(t) => navigate(`/leads?lead_id=${t.lead_id}`)} loading={loading} />
        )}
      </div>

      {modalTask && (
        <TaskModal
          task={modalTask}
          leads={leads}
          onClose={() => setModalTask(null)}
          onSave={saveTask}
          onDelete={modalTask.id ? () => deleteTask(modalTask.id as number) : undefined}
        />
      )}
    </div>
  );
}

function MonthGrid({ cursor, tasks, onDayClick, onTaskClick }: {
  cursor: Date; tasks: Task[]; onDayClick: (d: string) => void; onTaskClick: (t: Task) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) { const d = new Date(gridStart); d.setDate(d.getDate() + i); days.push(d); }
  const byDay: Record<string, Task[]> = {};
  tasks.forEach(t => { (byDay[t.due_date] ||= []).push(t); });
  const todayStr = fmtDate(new Date());

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--color-border-weak)' }}>
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => (
          <div key={d} style={{ padding: '8px', textAlign: 'center', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-tertiary)' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {days.map(d => {
          const ds = fmtDate(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const dayTasks = byDay[ds] || [];
          return (
            <div
              key={ds}
              onClick={() => onDayClick(ds)}
              style={{
                minHeight: '110px', padding: '6px', border: '1px solid var(--color-border-weak)',
                cursor: 'pointer', backgroundColor: inMonth ? 'var(--color-surface)' : 'var(--color-bg)',
                opacity: inMonth ? 1 : 0.5,
              }}
            >
              <div style={{
                fontSize: 'var(--text-xs)', fontWeight: ds === todayStr ? 700 : 500,
                color: ds === todayStr ? 'var(--color-primary)' : 'inherit', marginBottom: '4px',
              }}>{d.getDate()}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {dayTasks.slice(0, 3).map(t => {
                  const overdue = t.status === 'pending' && ds < todayStr;
                  return (
                    <div
                      key={t.id}
                      onClick={(e) => { e.stopPropagation(); onTaskClick(t); }}
                      style={{
                        fontSize: '11px', padding: '2px 4px', borderRadius: '4px', color: '#fff',
                        backgroundColor: TYPE_MAP[t.type][1], textDecoration: t.status === 'done' ? 'line-through' : 'none',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        border: overdue ? '2px solid #dc2626' : 'none',
                      }}
                    >
                      {overdue ? '⚠ ' : ''}{t.time_start ? `${t.time_start} ` : ''}{t.lead_name || t.lead_phone}
                    </div>
                  );
                })}
                {dayTasks.length > 3 && <div className="text-xs text-tertiary">+{dayTasks.length - 3} ещё</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimeGrid({ view, cursor, tasks, onSlotClick, onTaskClick, loading }: {
  view: 'day' | 'week'; cursor: Date; tasks: Task[];
  onSlotClick: (date: string, time: string) => void; onTaskClick: (t: Task) => void; loading: boolean;
}) {
  const days: Date[] = view === 'day' ? [cursor] : (() => {
    const s = startOfWeek(cursor); const arr: Date[] = [];
    for (let i = 0; i < 7; i++) { const d = new Date(s); d.setDate(d.getDate() + i); arr.push(d); }
    return arr;
  })();
  const ROW_H = 28;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayStr = fmtDate(now);

  const byDay: Record<string, Task[]> = {};
  tasks.forEach(t => { (byDay[t.due_date] ||= []).push(t); });

  const minutesOf = (hhmm: string | null, fallback: number) => {
    if (!hhmm) return fallback;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  return (
    <div className="card" style={{ padding: 0, display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: '56px', flexShrink: 0, borderRight: '1px solid var(--color-border-weak)' }}>
        <div style={{ height: '36px', borderBottom: '1px solid var(--color-border-weak)' }} />
        {Array.from({ length: SLOTS_PER_DAY }).map((_, i) => (
          <div key={i} style={{ height: `${ROW_H}px`, fontSize: '10px', color: 'var(--color-text-tertiary)', textAlign: 'right', paddingRight: '6px', borderBottom: i % 2 ? '1px dashed var(--color-border-weak)' : 'none' }}>
            {i % 2 === 0 ? slotTime(i) : ''}
          </div>
        ))}
      </div>
      {days.map(d => {
        const ds = fmtDate(d);
        const dayTasks = byDay[ds] || [];
        const isToday = ds === todayStr;
        return (
          <div key={ds} style={{ flex: 1, borderRight: '1px solid var(--color-border-weak)', position: 'relative' }}>
            <div style={{ height: '36px', borderBottom: '1px solid var(--color-border-weak)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-xs)', fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--color-primary)' : 'inherit' }}>
              {d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' })}
            </div>
            <div style={{ position: 'relative' }}>
              {Array.from({ length: SLOTS_PER_DAY }).map((_, i) => (
                <div
                  key={i}
                  onClick={() => onSlotClick(ds, slotTime(i))}
                  style={{ height: `${ROW_H}px`, borderBottom: i % 2 ? '1px dashed var(--color-border-weak)' : '1px solid var(--color-border-weak)', cursor: 'pointer' }}
                  className="hover-slot"
                />
              ))}
              {isToday && nowMinutes >= 0 && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: `${(nowMinutes / SLOT_MIN) * ROW_H}px`, height: '2px', backgroundColor: '#ef4444', zIndex: 2 }} />
              )}
              {dayTasks.map(t => {
                const start = minutesOf(t.time_start, 0);
                const end = minutesOf(t.time_end, start + SLOT_MIN);
                const top = (start / SLOT_MIN) * ROW_H;
                const height = Math.max(((end - start) / SLOT_MIN) * ROW_H, ROW_H);
                const overdue = t.status === 'pending' && (t.due_date < todayStr || (t.due_date === todayStr && minutesOf(t.time_end || t.time_start, 1440) <= nowMinutes));
                return (
                  <div
                    key={t.id}
                    onClick={(e) => { e.stopPropagation(); onTaskClick(t); }}
                    style={{
                      position: 'absolute', left: 0, right: 0, top: `${top}px`, height: `${height}px`,
                      backgroundColor: TYPE_MAP[t.type][1], color: '#fff', padding: '2px 6px',
                      fontSize: '11px', overflow: 'hidden', cursor: 'pointer', zIndex: 1, boxSizing: 'border-box',
                      border: overdue ? '2px solid #dc2626' : '1px solid rgba(255,255,255,0.4)',
                      textDecoration: t.status === 'done' ? 'line-through' : 'none', opacity: t.status === 'cancelled' ? 0.5 : 1,
                    }}
                    title={`${overdue ? 'ПРОСРОЧЕНО — ' : ''}${TYPE_MAP[t.type][0]}: ${t.lead_name || t.lead_phone}${t.note ? ' — ' + t.note : ''}`}
                  >
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 700 }}>{overdue ? '⚠ ' : ''}{t.lead_name || t.lead_phone}</span>
                    </div>
                    {height >= ROW_H * 1.4 && (
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.9 }}>
                        {t.time_start} {TYPE_MAP[t.type][0]}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%' }}>Загрузка...</div>}
    </div>
  );
}

function TaskModal({ task, leads, onClose, onSave, onDelete }: {
  task: Partial<Task>; leads: LeadOption[]; onClose: () => void;
  onSave: (t: Partial<Task>) => void; onDelete?: () => void;
}) {
  const [form, setForm] = useState<Partial<Task>>(task);
  const [leadSearch, setLeadSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredLeads = leadSearch
    ? leads.filter(l => (l.name || '').toLowerCase().includes(leadSearch.toLowerCase()) || (l.phone || '').includes(leadSearch))
    : leads.slice(0, 30);

  const handleSave = async () => {
    if (!form.lead_id || !form.due_date) { alert('Выберите лида и дату'); return; }
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const markDone = async () => {
    const result = window.prompt('Результат (необязательно):', form.result || '') ?? '';
    setSaving(true);
    try { await onSave({ ...form, status: 'done', result }); } finally { setSaving(false); }
  };

  return (
    <>
      <div className="side-panel-overlay" onClick={onClose} />
      <div className="card" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: '440px', maxWidth: '90vw', zIndex: 1000, padding: '24px',
      }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginTop: 0, marginBottom: '16px' }}>
          {task.id ? 'Задача' : 'Новая задача'}
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="flex gap-2">
            {(['call', 'meeting'] as const).map(t => (
              <button
                key={t}
                className={`btn ${form.type === t ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setForm({ ...form, type: t })}
                style={{ flex: 1 }}
              >
                {TYPE_MAP[t][0]}
              </button>
            ))}
          </div>

          <div>
            <label className="form-label">Лид</label>
            {form.id ? (
              <div className="card" style={{ padding: '10px 12px', backgroundColor: 'var(--color-bg)', boxShadow: 'none' }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{form.lead_name || 'Без имени'}</div>
                {form.lead_phone && <div className="text-sm text-secondary">{form.lead_phone}</div>}
                {form.company_name && <div className="text-xs text-tertiary" style={{ marginTop: '2px' }}>{form.company_name}</div>}
              </div>
            ) : (
              <>
                <input className="form-input" placeholder="Поиск лида по имени/телефону..." value={leadSearch} onChange={e => setLeadSearch(e.target.value)} />
                <select className="form-select" style={{ marginTop: '6px' }} value={form.lead_id || ''} onChange={e => setForm({ ...form, lead_id: Number(e.target.value) })}>
                  <option value="">Выберите лида</option>
                  {filteredLeads.map(l => (
                    <option key={l.id} value={l.id}>{l.name || 'Без имени'} — {l.phone}</option>
                  ))}
                </select>
              </>
            )}
          </div>

          <div className="flex gap-2">
            <div style={{ flex: 1 }}>
              <label className="form-label">Дата</label>
              <input type="date" className="form-input" value={form.due_date || ''} onChange={e => setForm({ ...form, due_date: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Начало</label>
              <input type="time" step="1800" className="form-input" value={form.time_start || ''} onChange={e => setForm({ ...form, time_start: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Конец</label>
              <input type="time" step="1800" className="form-input" value={form.time_end || ''} onChange={e => setForm({ ...form, time_end: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="form-label">Заметка</label>
            <textarea className="form-textarea" rows={2} value={form.note || ''} onChange={e => setForm({ ...form, note: e.target.value })} />
          </div>

          {form.status === 'done' && (
            <div>
              <label className="form-label">Результат</label>
              <div className="text-sm text-secondary">{form.result || '—'}</div>
            </div>
          )}
        </div>

        <div className="flex gap-2" style={{ marginTop: '20px', justifyContent: 'space-between' }}>
          <div className="flex gap-2">
            {onDelete && <button className="btn btn-ghost" onClick={onDelete}>🗑️ Удалить</button>}
            {task.id && form.status !== 'done' && (
              <button className="btn btn-secondary" onClick={markDone} disabled={saving}>✓ Выполнено</button>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '...' : 'Сохранить'}</button>
          </div>
        </div>
      </div>
    </>
  );
}
