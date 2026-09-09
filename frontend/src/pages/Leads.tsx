import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { saveXlsx } from '../utils/xlsx';

interface Lead {
  id: number;
  phone: string;
  name: string;
  title: string;
  status: 'new' | 'call' | 'interested' | 'meeting_scheduled' | 'meeting_done' | 'proposal' | 'deal';
  city: string;
  website: string;
  source_url: string;
  assigned_account: string;
  created_at: string;
  ai_message?: string;
  notes?: string;
  tags: string[];
  platform?: string;
  ig_username?: string;
  agreement_status?: 'green' | 'red' | null;
  niche?: string | null;
}

interface Message {
  id: number;
  direction: 'in' | 'out';
  content: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  sent_at: string;
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

const TASK_TYPE_LABELS: Record<string, string> = { call: 'Связаться', meeting: 'Встреча' };
const TASK_TYPE_COLORS: Record<string, string> = { call: '#3b82f6', meeting: '#f59e0b' };

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  call: 'Звонок',
  interested: 'Интерес',
  meeting_scheduled: 'Встреча назначена',
  meeting_done: 'Встреча проведена',
  proposal: 'КП',
  deal: 'Сделка'
};

const STATUS_CLASSES: Record<string, string> = {
  new: 'badge-new',
  call: 'badge-info',
  interested: 'badge-online',
  meeting_scheduled: 'badge-replied',
  meeting_done: 'badge-replied',
  proposal: 'badge-sent',
  deal: 'badge-online'
};

export function Leads() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<(Lead & { messages?: Message[] }) | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [generatingReply, setGeneratingReply] = useState(false);
  const [editingMessage, setEditingMessage] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newLead, setNewLead] = useState({ name: '', phone: '', city: '', status: 'contact', note: '', niche: '' });
  const [addingLead, setAddingLead] = useState(false);
  const [niches, setNiches] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/leads/niches').then(r => r.json()).then(d => setNiches(d.niches || [])).catch(() => {});
  }, []);

  const [leadNotes, setLeadNotes] = useState<LeadNote[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingNameText, setEditingNameText] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [leadTasks, setLeadTasks] = useState<LeadTask[]>([]);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [newTask, setNewTask] = useState({ type: 'call', due_date: '', time_start: '', time_end: '', note: '' });
  const [addingTask, setAddingTask] = useState(false);

  const handleGenerateReply = async () => {
    if (!selectedLead || generatingReply) return;
    setGeneratingReply(true);
    try {
      const res = await fetch(`/api/leads/${selectedLead.id}/generate_reply`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setReplyText(data.text);
      } else {
        const err = await res.json();
        alert(`Ошибка генерации: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при генерации');
    } finally {
      setGeneratingReply(false);
    }
  };

  const handleReply = async () => {
    if (!selectedLead || !replyText.trim() || sendingReply) return;
    setSendingReply(true);
    try {
      const res = await fetch(`/api/leads/${selectedLead.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: replyText.trim() })
      });
      if (res.ok) {
        const newMsg = await res.json();
        // Optimistically update UI
        setSelectedLead(prev => prev ? {
          ...prev,
          messages: [...(prev.messages || []), newMsg]
        } : null);
        setReplyText('');
      } else {
        const err = await res.json();
        alert(`Ошибка: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при отправке');
    } finally {
      setSendingReply(false);
    }
  };

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.append('search', search);
      if (statusFilter) qs.append('status', statusFilter);
      qs.append('limit', '1000000');

      const res = await fetch(`/api/leads?${qs.toString()}`);
      const data = await res.json();
      setLeads(data.leads || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [search, statusFilter]);

  useEffect(() => {
    const leadId = searchParams.get('lead_id');
    if (leadId) {
      handleSelect({ id: Number(leadId) } as Lead);
      searchParams.delete('lead_id');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = async (lead: Lead) => {
    // Optimistically open panel with shallow data
    setSelectedLead(lead);
    setLeadNotes([]);
    try {
      // Fetch full lead data including messages
      const res = await fetch(`/api/leads/${lead.id}`);
      if (res.ok) {
        const fullLead = await res.json();
        setSelectedLead(fullLead);
      }
    } catch (err) {
      console.error(err);
    }
    fetchLeadNotes(lead.id);
    fetchLeadTasks(lead.id);
  };

  const handleClosePanel = () => {
    setSelectedLead(null);
    setEditingMessage(null);
    setEditingName(false);
    setLeadNotes([]);
    setNewNoteText('');
    setLeadTasks([]);
    setShowTaskForm(false);
  };

  const handleDeleteLead = async (leadId: number) => {
    if (!window.confirm('Удалить лида? Это действие необратимо.')) return;
    try {
      const res = await fetch(`/api/leads/${leadId}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedLead?.id === leadId) handleClosePanel();
        setLeads(prev => prev.filter(l => l.id !== leadId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchLeadNotes = async (leadId: number) => {
    try {
      const res = await fetch(`/api/leads/${leadId}/notes`);
      if (res.ok) {
        setLeadNotes(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchLeadTasks = async (leadId: number) => {
    try {
      const res = await fetch(`/api/tasks?lead_id=${leadId}`);
      if (res.ok) {
        setLeadTasks(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddTask = async () => {
    if (!selectedLead || !newTask.due_date || addingTask) return;
    setAddingTask(true);
    try {
      const res = await fetch('/api/tasks/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: selectedLead.id, ...newTask }),
      });
      if (res.ok) {
        setNewTask({ type: 'call', due_date: '', time_start: '', time_end: '', note: '' });
        setShowTaskForm(false);
        fetchLeadTasks(selectedLead.id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAddingTask(false);
    }
  };

  const handleMarkTaskDone = async (task: LeadTask) => {
    if (!selectedLead) return;
    const result = window.prompt('Результат (необязательно):', task.result || '') ?? '';
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done', result }),
      });
      fetchLeadTasks(selectedLead.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!selectedLead || !window.confirm('Удалить задачу?')) return;
    try {
      await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      fetchLeadTasks(selectedLead.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddNote = async () => {
    if (!selectedLead || !newNoteText.trim() || addingNote) return;
    setAddingNote(true);
    try {
      const res = await fetch(`/api/leads/${selectedLead.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newNoteText.trim() })
      });
      if (res.ok) {
        const note = await res.json();
        setLeadNotes(prev => [note, ...prev]);
        setNewNoteText('');
      } else {
        const err = await res.json();
        alert(`Ошибка: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при сохранении заметки');
    } finally {
      setAddingNote(false);
    }
  };

  const handleStartEditNote = (note: LeadNote) => {
    setEditingNoteId(note.id);
    setEditingNoteText(note.text);
  };

  const handleCancelEditNote = () => {
    setEditingNoteId(null);
    setEditingNoteText('');
  };

  const handleSaveEditNote = async () => {
    if (!selectedLead || editingNoteId === null || !editingNoteText.trim() || savingNote) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/leads/${selectedLead.id}/notes/${editingNoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editingNoteText.trim() })
      });
      if (res.ok) {
        const updated = await res.json();
        setLeadNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
        setEditingNoteId(null);
        setEditingNoteText('');
      } else {
        const err = await res.json();
        alert(`Ошибка: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при сохранении заметки');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    if (!selectedLead) return;
    if (!window.confirm('Удалить заметку?')) return;
    try {
      const res = await fetch(`/api/leads/${selectedLead.id}/notes/${noteId}`, { method: 'DELETE' });
      if (res.ok) {
        setLeadNotes(prev => prev.filter(n => n.id !== noteId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddLead = async () => {
    if (!newLead.phone.trim() || addingLead) return;
    setAddingLead(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLead)
      });
      if (res.ok) {
        setShowAddModal(false);
        setNewLead({ name: '', phone: '', city: '', status: 'new', note: '', niche: '' });
        fetchLeads();
      } else {
        const err = await res.json();
        alert(`Ошибка: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при добавлении лида');
    } finally {
      setAddingLead(false);
    }
  };

  const handleMessageBlur = async () => {
    if (editingMessage === null || !selectedLead) return;
    try {
      const res = await fetch(`/api/ai/update-lead-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selectedLead.id, ai_message: editingMessage })
      });
      if (res.ok) {
        setSelectedLead({ ...selectedLead, ai_message: editingMessage });
        setLeads(leads.map(l => l.id === selectedLead.id ? { ...l, ai_message: editingMessage } : l));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setEditingMessage(null);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedLead) return;
    try {
      const res = await fetch(`/api/leads/${selectedLead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedLead(prev => prev ? { ...prev, status: updated.status } : null);
        setLeads(prev => prev.map(l => l.id === updated.id ? { ...l, status: updated.status } : l));
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Ошибка смены статуса: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при смене статуса');
    }
  };

  const handleAgreementChange = async (newAgreement: 'green' | 'red' | null) => {
    if (!selectedLead) return;
    try {
      const res = await fetch(`/api/leads/${selectedLead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agreement_status: newAgreement })
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedLead(prev => prev ? { ...prev, agreement_status: updated.agreement_status } : null);
        setLeads(prev => prev.map(l => l.id === updated.id ? { ...l, agreement_status: updated.agreement_status } : l));
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Ошибка смены отметки: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при смене отметки');
    }
  };

  const handleSaveName = async () => {
    if (!selectedLead || !editingNameText.trim() || savingName) return;
    setSavingName(true);
    try {
      const res = await fetch(`/api/leads/${selectedLead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingNameText.trim() })
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedLead(prev => prev ? { ...prev, name: updated.name } : null);
        setLeads(prev => prev.map(l => l.id === updated.id ? { ...l, name: updated.name } : l));
        setEditingName(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Ошибка сохранения имени: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при сохранении имени');
    } finally {
      setSavingName(false);
    }
  };

  const handleExportCsv = () => {
    window.location.href = '/api/leads/export/csv';
  };

  const agreementGreenPct = leads.length
    ? Math.round((leads.filter(l => l.agreement_status === 'green').length / leads.length) * 100)
    : 0;
  const agreementRedPct = leads.length
    ? Math.round((leads.filter(l => l.agreement_status === 'red').length / leads.length) * 100)
    : 0;

  const handleExportXlsx = () => saveXlsx('crm-leads.xlsx', [
    ['Имя', 'Телефон', 'Должность', 'Статус', 'Город', 'Сайт', 'Аккаунт', 'Дата'],
    ...leads.map((lead) => [
      lead.name,
      lead.phone,
      lead.title,
      STATUS_LABELS[lead.status] || lead.status,
      lead.city,
      lead.website,
      lead.assigned_account,
      lead.created_at ? new Date(lead.created_at).toLocaleString('ru-RU') : '',
    ]),
  ]);

  return (
    <div className="flex flex-col h-full">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1>Лиды / CRM</h1>
          <div className="text-sm text-secondary" style={{ marginTop: '4px' }}>
            Всего лидов: {leads.length}
            {leads.length > 0 && (
              <span style={{ marginLeft: '12px' }}>
                <span style={{ color: '#22c55e' }}>● {agreementGreenPct}% согласны</span>
                <span style={{ marginLeft: '10px', color: '#ef4444' }}>● {agreementRedPct}% не согласны</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={handleExportCsv}>📥 Экспорт CSV</button>
          <button className="btn btn-secondary" onClick={handleExportXlsx} disabled={!leads.length}>📥 Экспорт XLSX</button>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>➕ Добавить лида</button>
        </div>
      </div>

      {/* Page Body */}
      <div className="page-body">
        
        {/* Filters */}
        <div className="flex gap-3 mb-4 items-center">
          <input 
            type="text" 
            className="form-input" 
            style={{ maxWidth: '300px' }} 
            placeholder="🔍 Поиск по имени, телефону..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="form-select" style={{ maxWidth: '180px' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Все статусы</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button className="btn btn-ghost" onClick={() => { setSearch(''); setStatusFilter(''); }}>Сбросить</button>
        </div>

        {/* Data Table */}
        <div className="card" style={{ padding: 0 }}>
          <div className="table-container">
            <table style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Контакт</th>
                  <th>Телефон / Ник</th>
                  <th>Источник</th>
                  <th>Дата</th>
                  <th>Статус</th>
                  <th>Аккаунт</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading && leads.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>Загрузка...</td>
                  </tr>
                ) : leads.map(lead => (
                  <tr 
                    key={lead.id} 
                    onClick={() => handleSelect(lead)}
                    style={{ backgroundColor: selectedLead?.id === lead.id ? 'var(--color-surface-alt)' : undefined }}
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        {lead.agreement_status && (
                          <span
                            title={lead.agreement_status === 'green' ? 'Согласен' : 'Не согласен'}
                            style={{
                              width: '10px',
                              height: '10px',
                              borderRadius: '2px',
                              flexShrink: 0,
                              backgroundColor: lead.agreement_status === 'green' ? '#22c55e' : '#ef4444',
                            }}
                          />
                        )}
                        <div className="avatar-circle">
                          {(lead.name || 'Л').charAt(0).toUpperCase()}
                        </div>
                        <div style={{ fontWeight: 500 }}>{lead.name || 'Без имени'}</div>
                      </div>
                    </td>
                    <td>
                      <span className="mono">{lead.phone}</span>
                    </td>
                    <td>
                      <div style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {lead.title}
                      </div>
                      <div className="text-xs text-tertiary" style={{ marginTop: '4px' }}>
                        📍 {lead.city || 'Неизвестно'}
                        {lead.platform === 'google_maps' && (
                          <span style={{ marginLeft: '8px' }}>
                            🌍 Сайт: {lead.website ? <a href={lead.website} target="_blank" rel="noreferrer" style={{color:'var(--color-primary)'}}>Есть</a> : 'Нет'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="text-secondary text-sm">
                        {new Date(lead.created_at).toLocaleDateString('ru-RU')}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_CLASSES[lead.status] || 'badge-new'}`}>
                        {STATUS_LABELS[lead.status] || lead.status}
                      </span>
                    </td>
                    <td>
                      <span className="mono text-sm text-secondary">{lead.assigned_account || '-'}</span>
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '2px 8px' }}
                        title="Удалить лида"
                        onClick={(e) => { e.stopPropagation(); handleDeleteLead(lead.id); }}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && leads.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>
                      Лиды не найдены
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Side Panel Overlay & Panel */}
      {selectedLead && (
        <>
          <div className="side-panel-overlay" onClick={handleClosePanel} />
          <div className="side-panel">
            <div className="side-panel-header">
              <div>
                {editingName ? (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="form-input"
                      style={{ fontSize: 'var(--text-lg)', fontWeight: 600, padding: '2px 6px' }}
                      value={editingNameText}
                      onChange={e => setEditingNameText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                      autoFocus
                    />
                    <button className="btn btn-primary btn-sm" onClick={handleSaveName} disabled={!editingNameText.trim() || savingName}>
                      {savingName ? '...' : 'Сохранить'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingName(false)}>Отмена</button>
                  </div>
                ) : (
                  <h2
                    style={{ fontSize: 'var(--text-lg)', fontWeight: 600, margin: 0, cursor: 'pointer' }}
                    title="Нажмите, чтобы изменить имя"
                    onClick={() => { setEditingNameText(selectedLead.name || ''); setEditingName(true); }}
                  >
                    {selectedLead.name || 'Без имени'} ✏️
                    {selectedLead.platform === 'instagram' && (
                      <span style={{ marginLeft: '8px', fontSize: '14px', background: '#e1306c', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>IG</span>
                    )}
                  </h2>
                )}
                <div className="mono text-secondary text-sm" style={{ marginTop: '4px' }}>{selectedLead.phone}</div>
                {selectedLead.platform === 'instagram' && selectedLead.ai_message && (
                  <button 
                    className="btn btn-primary btn-sm" 
                    style={{ marginTop: '8px', padding: '4px 12px', background: '#e1306c', border: 'none' }}
                    onClick={() => {
                      navigator.clipboard.writeText(selectedLead.ai_message || '');
                      const username = selectedLead.ig_username || selectedLead.phone.replace('@', '');
                      window.open(`https://ig.me/m/${username}`, '_blank');
                    }}
                  >
                    🚀 Копировать и Написать в IG
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  title="Согласен"
                  onClick={() => handleAgreementChange(selectedLead.agreement_status === 'green' ? null : 'green')}
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    backgroundColor: '#22c55e',
                    border: selectedLead.agreement_status === 'green' ? '2px solid var(--color-text-primary)' : '2px solid transparent',
                    opacity: selectedLead.agreement_status === 'green' ? 1 : 0.4,
                    padding: 0,
                  }}
                />
                <button
                  title="Не согласен"
                  onClick={() => handleAgreementChange(selectedLead.agreement_status === 'red' ? null : 'red')}
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    backgroundColor: '#ef4444',
                    border: selectedLead.agreement_status === 'red' ? '2px solid var(--color-text-primary)' : '2px solid transparent',
                    opacity: selectedLead.agreement_status === 'red' ? 1 : 0.4,
                    padding: 0,
                  }}
                />
                <button
                  className="btn btn-ghost"
                  title="Удалить лида"
                  onClick={() => handleDeleteLead(selectedLead.id)}
                  style={{ padding: '4px 8px' }}
                >
                  🗑️
                </button>
                <button className="btn btn-ghost" onClick={handleClosePanel} style={{ padding: '4px 8px' }}>✕</button>
              </div>
            </div>

            <div className="side-panel-body">
              {/* Status block */}
              <div>
                <label className="form-label">Статус лида</label>
                <select className="form-select" value={selectedLead.status} onChange={e => handleStatusChange(e.target.value)}>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              {/* Source info */}
              <div>
                <label className="form-label">Источник (Объявление)</label>
                <div className="card" style={{ padding: '16px', backgroundColor: 'var(--color-bg)', boxShadow: 'none' }}>
                  {selectedLead.platform === 'instagram' && (selectedLead.ig_username || selectedLead.phone) ? (
                    <a 
                      href={`https://www.instagram.com/${selectedLead.ig_username || selectedLead.phone.replace('@', '')}/`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ fontWeight: 500, fontSize: 'var(--text-sm)', marginBottom: '4px', color: 'var(--color-primary)', textDecoration: 'none', display: 'block' }}
                    >
                      {selectedLead.title || `@${selectedLead.ig_username || selectedLead.phone}`} ↗
                    </a>
                  ) : (
                    <div style={{ fontWeight: 500, fontSize: 'var(--text-sm)', marginBottom: '4px' }}>{selectedLead.title}</div>
                  )}
                  <div className="text-xs text-tertiary">📍 {selectedLead.city || 'Неизвестно'}</div>
                  {selectedLead.platform === 'google_maps' && (
                    <div className="text-xs text-tertiary" style={{ marginTop: '2px' }}>
                      🌍 Сайт: {selectedLead.website ? <a href={selectedLead.website} target="_blank" rel="noreferrer" style={{color:'var(--color-primary)', textDecoration:'underline'}}>{selectedLead.website}</a> : 'Нет'}
                    </div>
                  )}
                </div>
              </div>

              {/* AI Message Preview */}
              {selectedLead.ai_message && (
                <div>
                  <label className="form-label flex justify-between items-center">
                    🤖 AI Сгенерированное сообщение
                    <span className="text-xs font-normal text-tertiary">(кликните чтобы изменить)</span>
                  </label>
                  <div className="card" style={{ padding: '0', backgroundColor: '#EEF2FF', borderColor: 'var(--color-primary)', boxShadow: 'none', overflow: 'hidden' }}>
                    <textarea 
                      className="form-input"
                      style={{ 
                        border: 'none', 
                        backgroundColor: 'transparent', 
                        resize: 'none', 
                        fontSize: 'var(--text-sm)', 
                        lineHeight: 1.5, 
                        color: 'var(--color-primary)',
                        minHeight: '120px',
                        padding: '16px'
                      }}
                      value={editingMessage !== null ? editingMessage : selectedLead.ai_message}
                      onChange={e => setEditingMessage(e.target.value)}
                      onBlur={handleMessageBlur}
                    />
                  </div>
                </div>
              )}

              {/* Source link (map card) */}
              <div>
                <label className="form-label">Ссылка на карту</label>
                {selectedLead.source_url ? (
                  <a
                    href={selectedLead.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 'var(--text-sm)', color: 'var(--color-primary)', textDecoration: 'underline', wordBreak: 'break-all' }}
                  >
                    {selectedLead.source_url} ↗
                  </a>
                ) : (
                  <span className="text-xs text-secondary">Нет ссылки</span>
                )}
              </div>

              {/* Notes history */}
              <div>
                <label className="form-label">Заметки</label>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder="Новая заметка..."
                    value={newNoteText}
                    onChange={e => setNewNoteText(e.target.value)}
                    style={{ flex: 1, resize: 'none' }}
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={handleAddNote}
                    disabled={!newNoteText.trim() || addingNote}
                    style={{ padding: '8px 12px' }}
                  >
                    {addingNote ? '...' : 'Добавить'}
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                  {leadNotes.map(note => (
                    <div key={note.id} className="card" style={{ padding: '10px 12px', backgroundColor: 'var(--color-bg)', boxShadow: 'none', flexShrink: 0 }}>
                      {editingNoteId === note.id ? (
                        <>
                          <textarea
                            className="form-textarea"
                            rows={2}
                            value={editingNoteText}
                            onChange={e => setEditingNoteText(e.target.value)}
                            style={{ width: '100%', resize: 'none', marginBottom: '6px' }}
                          />
                          <div className="flex gap-2">
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 10px', fontSize: 'var(--text-xs)' }}
                              onClick={handleSaveEditNote}
                              disabled={!editingNoteText.trim() || savingNote}
                            >
                              {savingNote ? '...' : 'Сохранить'}
                            </button>
                            <button
                              className="btn btn-ghost"
                              style={{ padding: '4px 10px', fontSize: 'var(--text-xs)' }}
                              onClick={handleCancelEditNote}
                            >
                              Отмена
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap' }}>{note.text}</div>
                          <div className="flex items-center justify-between" style={{ marginTop: '6px' }}>
                            <div className="text-xs text-tertiary">
                              {new Date(note.created_at).toLocaleString('ru-RU')}
                            </div>
                            <div className="flex gap-2">
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
                                onClick={() => handleStartEditNote(note)}
                                title="Редактировать"
                              >
                                ✏️
                              </button>
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
                                onClick={() => handleDeleteNote(note.id)}
                                title="Удалить"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {leadNotes.length === 0 && (
                    <div className="text-sm text-secondary">Заметок пока нет</div>
                  )}
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--color-border-weak)' }} />

              {/* Tasks (звонки/встречи) */}
              <div>
                <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Задачи</label>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '4px 10px', fontSize: 'var(--text-xs)' }}
                    onClick={() => setShowTaskForm(v => !v)}
                  >
                    {showTaskForm ? 'Отмена' : '+ Задача'}
                  </button>
                </div>

                {showTaskForm && (
                  <div className="card" style={{ padding: '10px 12px', backgroundColor: 'var(--color-bg)', boxShadow: 'none', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div className="flex gap-2">
                      {(['call', 'meeting'] as const).map(t => (
                        <button
                          key={t}
                          className={`btn ${newTask.type === t ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ flex: 1, padding: '6px', fontSize: 'var(--text-xs)' }}
                          onClick={() => setNewTask({ ...newTask, type: t })}
                        >
                          {TASK_TYPE_LABELS[t]}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input type="date" className="form-input" style={{ flex: 1 }} value={newTask.due_date} onChange={e => setNewTask({ ...newTask, due_date: e.target.value })} />
                      <input type="time" step="1800" className="form-input" style={{ flex: 1 }} value={newTask.time_start} onChange={e => setNewTask({ ...newTask, time_start: e.target.value })} />
                      <input type="time" step="1800" className="form-input" style={{ flex: 1 }} value={newTask.time_end} onChange={e => setNewTask({ ...newTask, time_end: e.target.value })} />
                    </div>
                    <textarea
                      className="form-textarea"
                      rows={2}
                      placeholder="Заметка к задаче..."
                      value={newTask.note}
                      onChange={e => setNewTask({ ...newTask, note: e.target.value })}
                      style={{ resize: 'none' }}
                    />
                    <button
                      className="btn btn-primary"
                      style={{ alignSelf: 'flex-end', padding: '6px 14px', fontSize: 'var(--text-xs)' }}
                      onClick={handleAddTask}
                      disabled={!newTask.due_date || addingTask}
                    >
                      {addingTask ? '...' : 'Создать'}
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
                  {leadTasks.map(task => (
                    <div key={task.id} className="card" style={{ padding: '10px 12px', backgroundColor: 'var(--color-bg)', boxShadow: 'none', flexShrink: 0 }}>
                      <div className="flex items-center justify-between">
                        <span
                          style={{
                            fontSize: '11px', padding: '2px 8px', borderRadius: '4px', color: '#fff',
                            backgroundColor: TASK_TYPE_COLORS[task.type],
                            textDecoration: task.status === 'done' ? 'line-through' : 'none',
                            opacity: task.status === 'cancelled' ? 0.5 : 1,
                          }}
                        >
                          {TASK_TYPE_LABELS[task.type]}
                        </span>
                        <div className="text-xs text-tertiary">
                          {new Date(task.due_date).toLocaleDateString('ru-RU')}{task.time_start ? `, ${task.time_start}` : ''}
                        </div>
                      </div>
                      {task.note && <div style={{ fontSize: 'var(--text-sm)', marginTop: '6px', whiteSpace: 'pre-wrap' }}>{task.note}</div>}
                      {task.status === 'done' && task.result && (
                        <div className="text-xs text-secondary" style={{ marginTop: '4px' }}>Результат: {task.result}</div>
                      )}
                      <div className="flex gap-2" style={{ marginTop: '8px' }}>
                        {task.status === 'pending' && (
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
                            onClick={() => handleMarkTaskDone(task)}
                          >
                            ✓ Выполнено
                          </button>
                        )}
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
                          onClick={() => handleDeleteTask(task.id)}
                          title="Удалить"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                  {leadTasks.length === 0 && !showTaskForm && (
                    <div className="text-sm text-secondary">Задач пока нет</div>
                  )}
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--color-border-weak)' }} />

              {/* Message History */}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <label className="form-label mb-4">История переписки</label>
                <div className="message-list" style={{ flex: 1, overflowY: 'auto', marginBottom: '16px' }}>
                  {(selectedLead.messages || []).map(msg => (
                    <div key={msg.id} className={`message-item ${msg.direction}`}>
                      <div className="message-bubble">
                        {msg.content}
                      </div>
                      <div className="message-meta">
                        {new Date(msg.sent_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} 
                        {msg.direction === 'out' && (
                          <span style={{ color: msg.status === 'read' ? 'var(--color-primary)' : 'inherit', marginLeft: '4px' }}>
                            {msg.status === 'read' ? '✓✓' : '✓'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {selectedLead.messages && selectedLead.messages.length === 0 && (
                    <div className="text-sm text-secondary">Нет сообщений</div>
                  )}
                  {!selectedLead.messages && (
                    <div className="text-sm text-secondary">Загрузка сообщений...</div>
                  )}
                </div>
                
                {/* Reply Box */}
                {selectedLead.assigned_account && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexDirection: 'column' }}>
                    <div style={{ width: '100%', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                      <textarea 
                        className="form-textarea" 
                        rows={2} 
                        placeholder="Напишите ответ..." 
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleReply();
                          }
                        }}
                        style={{ flex: 1, resize: 'none' }}
                      />
                      <button 
                        className="btn btn-primary" 
                        onClick={handleReply}
                        disabled={!replyText.trim() || sendingReply}
                        style={{ padding: '12px 16px', height: '100%' }}
                      >
                        {sendingReply ? '...' : '▶'}
                      </button>
                    </div>
                    <button 
                      className="btn btn-ghost" 
                      onClick={handleGenerateReply}
                      disabled={generatingReply || !selectedLead.messages?.length}
                      style={{ alignSelf: 'flex-start', padding: '4px 8px', fontSize: '13px' }}
                    >
                      {generatingReply ? '✨ Генерирую...' : '✨ Сгенерировать ответ (ИИ)'}
                    </button>
                  </div>
                )}
                {!selectedLead.assigned_account && selectedLead.messages && selectedLead.messages.length > 0 && (
                  <div className="text-xs text-secondary mt-2">Нельзя ответить: нет привязанного аккаунта</div>
                )}
              </div>

            </div>
          </div>
        </>
      )}

      {/* Add Lead Modal */}
      {showAddModal && (
        <>
          <div className="side-panel-overlay" onClick={() => setShowAddModal(false)} />
          <div className="card" style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: '420px', maxWidth: '90vw', zIndex: 1000, padding: '24px'
          }}>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginTop: 0, marginBottom: '16px' }}>Добавить лида</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="form-label">Имя</label>
                <input className="form-input" value={newLead.name} onChange={e => setNewLead({ ...newLead, name: e.target.value })} placeholder="Иван Иванов" />
              </div>
              <div>
                <label className="form-label">Телефон *</label>
                <input className="form-input" value={newLead.phone} onChange={e => setNewLead({ ...newLead, phone: e.target.value })} placeholder="+7 999 000 00 00" />
              </div>
              <div>
                <label className="form-label">Город</label>
                <input className="form-input" value={newLead.city} onChange={e => setNewLead({ ...newLead, city: e.target.value })} placeholder="Москва" />
              </div>
              <div>
                <label className="form-label">Статус</label>
                <select className="form-select" value={newLead.status} onChange={e => setNewLead({ ...newLead, status: e.target.value })}>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Ниша</label>
                <select className="form-select" value={newLead.niche} onChange={e => setNewLead({ ...newLead, niche: e.target.value })}>
                  <option value="">Без ниши</option>
                  {niches.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Заметка (необязательно)</label>
                <textarea className="form-textarea" rows={2} value={newLead.note} onChange={e => setNewLead({ ...newLead, note: e.target.value })} placeholder="Комментарий по лиду..." />
              </div>
            </div>

            <div className="flex gap-2" style={{ marginTop: '20px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowAddModal(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={handleAddLead} disabled={!newLead.phone.trim() || addingLead}>
                {addingLead ? 'Сохранение...' : 'Добавить'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
