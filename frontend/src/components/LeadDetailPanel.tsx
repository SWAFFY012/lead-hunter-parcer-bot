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

const TASK_TYPE_LABELS: Record<string, string> = { call: 'Связаться', meeting: 'Встреча' };
const TASK_TYPE_COLORS: Record<string, string> = { call: '#3b82f6', meeting: '#f59e0b' };

interface Props {
  lead: PanelLead;
  niches: string[];
  onClose: () => void;
  onLeadUpdated: (lead: PanelLead) => void;
}

export function LeadDetailPanel({ lead, niches, onClose, onLeadUpdated }: Props) {
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');

  const [tasks, setTasks] = useState<LeadTask[]>([]);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [newTask, setNewTask] = useState({ type: 'call', due_date: '', time_start: '', time_end: '', note: '' });
  const [addingTask, setAddingTask] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [nameText, setNameText] = useState(lead.name || '');

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
        setNewTask({ type: 'call', due_date: '', time_start: '', time_end: '', note: '' });
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
          </div>

          <div className="lead-panel-meta">
            {lead.city && <span>{lead.city}</span>}
            {lead.website && (
              <a href={lead.website} target="_blank" rel="noreferrer">{lead.website}</a>
            )}
            {lead.phone && <a href={`tel:${lead.phone}`}>Позвонить</a>}
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
                  <option value="call">Связаться</option>
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
                  type="time"
                  value={newTask.time_start}
                  onChange={e => setNewTask({ ...newTask, time_start: e.target.value })}
                />
                <input
                  className="form-input"
                  type="time"
                  value={newTask.time_end}
                  onChange={e => setNewTask({ ...newTask, time_end: e.target.value })}
                />
                <input
                  className="form-input"
                  style={{ gridColumn: '1 / -1' }}
                  placeholder="Комментарий"
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
                  <div className="text-sm" style={{ textDecoration: task.status === 'done' ? 'line-through' : undefined }}>
                    {task.due_date}
                    {task.time_start ? ` ${task.time_start}` : ''}
                    {task.time_end ? `–${task.time_end}` : ''}
                  </div>
                  {task.note && <div className="text-xs text-secondary">{task.note}</div>}
                  {task.result && <div className="text-xs text-secondary">Результат: {task.result}</div>}
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
                    <div style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap' }} className="text-sm">{note.text}</div>
                    <button className="btn btn-ghost" onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.text); }}>✎</button>
                    <button className="btn btn-ghost" onClick={() => handleDeleteNote(note.id)}>✕</button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
