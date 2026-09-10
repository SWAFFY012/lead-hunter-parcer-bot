import React, { useState, useEffect } from 'react';

export interface PanelLead {
  id: number;
  name: string;
  phone: string;
  status: string;
  title?: string;
  city?: string;
  website?: string;
  niche?: string | null;
  owner?: string | null;
  source_url?: string | null;
  platform?: string | null;
  agreement_status?: 'green' | 'red' | null;
}

interface LeadNote {
  id: number;
  lead_id: number;
  text: string;
  created_at: string;
}

interface LeadTask {
  id: number;
  lead_id: number;
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

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  call: 'Звонок',
  interested: 'Интерес',
  meeting_scheduled: 'Встреча назначена',
  meeting_done: 'Встреча проведена',
  proposal: 'КП',
  deal: 'Сделка'
};

const TASK_TYPE_LABELS: Record<string, string> = { call: 'Звонок', meeting: 'Встреча' };
const TASK_TYPE_COLORS: Record<string, string> = { call: '#3b82f6', meeting: '#f59e0b' };

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// due_date приходит как DATE, но драйвер отдаёт ISO-строку со временем — берём только дату
function parseDueDate(due: string): Date | null {
  const ymd = String(due || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatDueDate(due: string): string {
  const d = parseDueDate(due);
  if (!d) return due;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);

  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}, ${WEEKDAYS[d.getDay()]}`;
  if (days === 0) return `Сегодня, ${base}`;
  if (days === 1) return `Завтра, ${base}`;
  if (days === -1) return `Вчера, ${base}`;
  if (d.getFullYear() !== today.getFullYear()) return `${base} ${d.getFullYear()}`;
  return base;
}

function formatTime(start: string | null, end: string | null): string {
  const cut = (t: string | null) => (t ? String(t).slice(0, 5) : '');
  const a = cut(start);
  const b = cut(end);
  if (a && b) return `${a}–${b}`;
  return a || b || '';
}

// created_at — полноценный timestamp, показываем дату и время создания заметки
function formatNoteDate(created: string): string {
  const d = new Date(created);
  if (Number.isNaN(d.getTime())) return '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day.getTime() - today.getTime()) / 86400000);

  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (days === 0) return `Сегодня, ${time}`;
  if (days === -1) return `Вчера, ${time}`;

  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const year = d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${base}${year}, ${time}`;
}

function isOverdue(due: string): boolean {
  const d = parseDueDate(due);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

interface Props {
  lead: PanelLead;
  niches: string[];
  owners: string[];
  onClose: () => void;
  onLeadUpdated: (lead: PanelLead) => void;
  onOwnersChanged?: (owners: string[]) => void;
  onLeadDeleted?: (leadId: number) => void;
}

const NEW_OWNER = '__new__';

export function LeadDetailPanel({ lead, niches, owners, onClose, onLeadUpdated, onOwnersChanged, onLeadDeleted }: Props) {
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');

  const [tasks, setTasks] = useState<LeadTask[]>([]);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [newTask, setNewTask] = useState({ type: 'call', due_date: '', time_start: '', note: '' });
  const [addingTask, setAddingTask] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [nameText, setNameText] = useState(lead.name || '');

  const [deletingLead, setDeletingLead] = useState(false);

  const [addingOwner, setAddingOwner] = useState(false);
  const [newOwnerText, setNewOwnerText] = useState('');
  const [savingOwner, setSavingOwner] = useState(false);

  const fetchNotes = (leadId: number) => {
    fetch(`/api/leads/${leadId}/notes`)
      .then(r => (r.ok ? r.json() : []))
      .then(d => setNotes(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  const fetchTasks = (leadId: number) => {
    fetch(`/api/tasks/?lead_id=${leadId}`)
      .then(r => (r.ok ? r.json() : []))
      .then(d => setTasks(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  useEffect(() => {
    setNameText(lead.name || '');
    setEditingName(false);
    setAddingOwner(false);
    setNewOwnerText('');
    fetchNotes(lead.id);
    fetchTasks(lead.id);
  }, [lead.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patchLead = async (body: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const updated = await res.json();
        onLeadUpdated({ ...lead, ...updated });
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Ошибка сохранения: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети');
    }
  };

  const handleSaveName = async () => {
    const value = nameText.trim();
    setEditingName(false);
    if (value === (lead.name || '')) return;
    await patchLead({ name: value });
  };

  const handleDeleteLead = async () => {
    if (deletingLead) return;
    const label = lead.name || lead.phone;
    if (!window.confirm(`Удалить лида «${label}»? Вместе с ним удалятся его задачи и заметки. Действие необратимо.`)) return;
    setDeletingLead(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' });
      if (res.ok) {
        onLeadDeleted?.(lead.id);
        onClose();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Ошибка удаления: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети');
    } finally {
      setDeletingLead(false);
    }
  };

  const handleAddOwner = async () => {
    const value = newOwnerText.trim();
    if (!value || savingOwner) return;
    setSavingOwner(true);
    try {
      const next = Array.from(new Set([...owners, value]));
      const res = await fetch('/api/leads/owners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owners: next })
      });
      if (res.ok) {
        onOwnersChanged?.(next);
        setNewOwnerText('');
        setAddingOwner(false);
        await patchLead({ owner: value });
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Ошибка: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети');
    } finally {
      setSavingOwner(false);
    }
  };

  const handleAddTask = async () => {
    if (!newTask.due_date || addingTask) return;
    setAddingTask(true);
    try {
      const res = await fetch('/api/tasks/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id, ...newTask })
      });
      if (res.ok) {
        setNewTask({ type: 'call', due_date: '', time_start: '', note: '' });
        setShowTaskForm(false);
        fetchTasks(lead.id);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Ошибка: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAddingTask(false);
    }
  };

  const handleMarkTaskDone = async (task: LeadTask) => {
    const result = window.prompt('Результат (необязательно):', task.result || '') ?? '';
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done', result })
      });
      fetchTasks(lead.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!window.confirm('Удалить задачу?')) return;
    try {
      await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      fetchTasks(lead.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddNote = async () => {
    if (!newNoteText.trim() || savingNote) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newNoteText.trim() })
      });
      if (res.ok) {
        const note = await res.json();
        setNotes(prev => [note, ...prev]);
        setNewNoteText('');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingNote(false);
    }
  };

  const handleSaveEditNote = async () => {
    if (editingNoteId === null || !editingNoteText.trim() || savingNote) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/notes/${editingNoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editingNoteText.trim() })
      });
      if (res.ok) {
        const updated = await res.json();
        setNotes(prev => prev.map(n => (n.id === updated.id ? updated : n)));
        setEditingNoteId(null);
        setEditingNoteText('');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    if (!window.confirm('Удалить заметку?')) return;
    try {
      const res = await fetch(`/api/leads/${lead.id}/notes/${noteId}`, { method: 'DELETE' });
      if (res.ok) setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (err) {
      console.error(err);
    }
  };

  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const doneTasks = tasks.filter(t => t.status !== 'pending');

  return (
    <div className="lead-panel-overlay" onClick={onClose}>
      <div className="lead-panel" onClick={e => e.stopPropagation()}>
        <div className="lead-panel-header">
          <div style={{ minWidth: 0 }}>
            {editingName ? (
              <input
                className="form-input"
                autoFocus
                value={nameText}
                onChange={e => setNameText(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') { setNameText(lead.name || ''); setEditingName(false); }
                }}
                style={{ fontSize: '18px', fontWeight: 600 }}
              />
            ) : (
              <div
                style={{ fontSize: '18px', fontWeight: 600, cursor: 'text' }}
                title="Нажмите, чтобы изменить"
                onClick={() => setEditingName(true)}
              >
                {lead.name || 'Без имени'}
              </div>
            )}
            <div className="mono text-sm text-secondary" style={{ marginTop: '4px' }}>{lead.phone}</div>
            {lead.title && <div className="text-sm text-secondary" style={{ marginTop: '2px' }}>{lead.title}</div>}
          </div>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>

        <div className="lead-panel-body">
          <div className="lead-panel-grid">
            <div>
              <label className="form-label">Статус</label>
              <select
                className="form-select"
                value={lead.status}
                onChange={e => patchLead({ status: e.target.value })}
              >
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label">Ниша (воронка)</label>
              <select
                className="form-select"
                value={lead.niche || ''}
                onChange={e => patchLead({ niche: e.target.value || null })}
              >
                <option value="">Без ниши</option>
                {niches.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Ответственный</label>
              {addingOwner ? (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    className="form-input"
                    autoFocus
                    placeholder="Имя ответственного"
                    value={newOwnerText}
                    onChange={e => setNewOwnerText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddOwner();
                      if (e.key === 'Escape') { setAddingOwner(false); setNewOwnerText(''); }
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleAddOwner}
                    disabled={!newOwnerText.trim() || savingOwner}
                  >
                    {savingOwner ? '...' : 'OK'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => { setAddingOwner(false); setNewOwnerText(''); }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <select
                  className="form-select"
                  value={lead.owner || ''}
                  onChange={e => {
                    if (e.target.value === NEW_OWNER) { setAddingOwner(true); return; }
                    patchLead({ owner: e.target.value || null });
                  }}
                >
                  <option value="">Без ответственного</option>
                  {owners.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                  {lead.owner && !owners.includes(lead.owner) && (
                    <option value={lead.owner}>{lead.owner}</option>
                  )}
                  <option value={NEW_OWNER}>+ Добавить человека…</option>
                </select>
              )}
            </div>
          </div>

          <div className="lead-panel-meta">
            {lead.city && <span>{lead.city}</span>}
            {lead.website && (
              <a href={lead.website} target="_blank" rel="noreferrer">{lead.website}</a>
            )}
            {lead.source_url && (
              <a href={lead.source_url} target="_blank" rel="noreferrer">
                {lead.platform === 'yandex_maps' ? '📍 Яндекс.Карты' : '📍 Источник'}
              </a>
            )}
          </div>

          <div className="lead-panel-section">
            <div className="lead-panel-section-head">
              <h4>Задачи{pendingTasks.length > 0 ? ` (${pendingTasks.length})` : ''}</h4>
              <button className="btn btn-ghost" onClick={() => setShowTaskForm(v => !v)}>
                {showTaskForm ? 'Отмена' : '+ Задача'}
              </button>
            </div>

            {showTaskForm && (
              <div className="lead-task-form">
                <select
                  className="form-select"
                  value={newTask.type}
                  onChange={e => setNewTask({ ...newTask, type: e.target.value })}
                >
                  <option value="call">Звонок</option>
                  <option value="meeting">Встреча</option>
                </select>
                <input
                  className="form-input"
                  type="date"
                  value={newTask.due_date}
                  onChange={e => setNewTask({ ...newTask, due_date: e.target.value })}
                />
                <input
                  className="form-input"
                  style={{ gridColumn: '1 / -1' }}
                  type="time"
                  value={newTask.time_start}
                  onChange={e => setNewTask({ ...newTask, time_start: e.target.value })}
                />
                <input
                  className="form-input"
                  style={{ gridColumn: '1 / -1' }}
                  placeholder="Комментарий (необязательно)"
                  value={newTask.note}
                  onChange={e => setNewTask({ ...newTask, note: e.target.value })}
                />
                <button
                  className="btn btn-primary"
                  style={{ gridColumn: '1 / -1' }}
                  onClick={handleAddTask}
                  disabled={!newTask.due_date || addingTask}
                >
                  {addingTask ? 'Сохраняю...' : 'Добавить задачу'}
                </button>
              </div>
            )}

            {tasks.length === 0 && !showTaskForm && (
              <div className="text-sm text-secondary">Задач нет</div>
            )}

            {[...pendingTasks, ...doneTasks].map(task => (
              <div key={task.id} className="lead-task-row">
                <span
                  className="badge"
                  style={{ backgroundColor: TASK_TYPE_COLORS[task.type], color: '#fff' }}
                >
                  {TASK_TYPE_LABELS[task.type]}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="text-sm"
                    style={{
                      textDecoration: task.status === 'done' ? 'line-through' : undefined,
                      color: task.status === 'pending' && isOverdue(task.due_date) ? 'var(--color-error)' : undefined
                    }}
                  >
                    {formatDueDate(task.due_date)}
                    {formatTime(task.time_start, task.time_end) && (
                      <span style={{ marginLeft: '8px', fontWeight: 600 }}>
                        {formatTime(task.time_start, task.time_end)}
                      </span>
                    )}
                  </div>
                  {task.note && <div className="text-xs text-secondary" style={{ marginTop: '2px' }}>{task.note}</div>}
                  {task.result && <div className="text-xs text-secondary" style={{ marginTop: '2px' }}>Результат: {task.result}</div>}
                </div>
                {task.status === 'pending' && (
                  <button className="btn btn-ghost" onClick={() => handleMarkTaskDone(task)}>✓</button>
                )}
                <button className="btn btn-ghost" onClick={() => handleDeleteTask(task.id)}>✕</button>
              </div>
            ))}
          </div>

          <div className="lead-panel-section">
            <div className="lead-panel-section-head">
              <h4>Заметки{notes.length > 0 ? ` (${notes.length})` : ''}</h4>
            </div>
            <div className="lead-note-add">
              <textarea
                className="form-input"
                rows={2}
                placeholder="Новая заметка"
                value={newNoteText}
                onChange={e => setNewNoteText(e.target.value)}
              />
              <button
                className="btn btn-primary"
                onClick={handleAddNote}
                disabled={!newNoteText.trim() || savingNote}
              >
                Добавить
              </button>
            </div>

            {notes.length === 0 && <div className="text-sm text-secondary">Заметок нет</div>}

            {notes.map(note => (
              <div key={note.id} className="lead-note-row">
                {editingNoteId === note.id ? (
                  <>
                    <textarea
                      className="form-input"
                      rows={2}
                      value={editingNoteText}
                      onChange={e => setEditingNoteText(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="btn btn-primary" onClick={handleSaveEditNote} disabled={savingNote}>OK</button>
                      <button className="btn btn-ghost" onClick={() => { setEditingNoteId(null); setEditingNoteText(''); }}>✕</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ whiteSpace: 'pre-wrap' }} className="text-sm">{note.text}</div>
                      <div className="text-xs text-secondary" style={{ marginTop: '4px' }}>
                        {formatNoteDate(note.created_at)}
                      </div>
                    </div>
                    <button className="btn btn-ghost" onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.text); }}>✎</button>
                    <button className="btn btn-ghost" onClick={() => handleDeleteNote(note.id)}>✕</button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="lead-panel-section">
            <button
              className="btn"
              onClick={handleDeleteLead}
              disabled={deletingLead}
              style={{
                width: '100%',
                color: '#ef4444',
                border: '1px solid #ef4444',
                backgroundColor: 'transparent'
              }}
            >
              {deletingLead ? 'Удаляю...' : '🗑️ Удалить лида'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
