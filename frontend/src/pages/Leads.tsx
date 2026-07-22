import React, { useState, useEffect } from 'react';

interface Lead {
  id: number;
  phone: string;
  name: string;
  title: string;
  status: 'new' | 'sent' | 'replied' | 'interested' | 'deal' | 'refused';
  city: string;
  website: string;
  assigned_account: string;
  created_at: string;
  ai_message?: string;
  notes?: string;
  tags: string[];
  platform?: string;
  ig_username?: string;
}

interface Message {
  id: number;
  direction: 'in' | 'out';
  content: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  sent_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Новый',
  ready_to_send: 'Готов к отправке',
  sent: 'Отправлено',
  invalid_number: 'Нет в WA',
  failed: 'Ошибка',
  replied: 'Ответил',
  interested: 'Интерес',
  deal: 'Сделка',
  refused: 'Отказ'
};

const STATUS_CLASSES: Record<string, string> = {
  new: 'badge-new',
  ready_to_send: 'badge-info',
  sent: 'badge-sent',
  invalid_number: 'badge-new',
  failed: 'badge-error',
  replied: 'badge-replied',
  interested: 'badge-online',
  deal: 'badge-online',
  refused: 'badge-new'
};

export function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<(Lead & { messages?: Message[] }) | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [generatingReply, setGeneratingReply] = useState(false);
  const [editingMessage, setEditingMessage] = useState<string | null>(null);

  const handleGenerateReply = async () => {
    if (!selectedLead || generatingReply) return;
    setGeneratingReply(true);
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/leads/${selectedLead.id}/generate_reply`, {
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
      const res = await fetch(`http://${window.location.hostname}:3001/api/leads/${selectedLead.id}/reply`, {
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
      qs.append('limit', '100'); // Fetch up to 100 recent

      const res = await fetch(`http://${window.location.hostname}:3001/api/leads?${qs.toString()}`);
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

  const handleSelect = async (lead: Lead) => {
    // Optimistically open panel with shallow data
    setSelectedLead(lead);
    try {
      // Fetch full lead data including messages
      const res = await fetch(`http://${window.location.hostname}:3001/api/leads/${lead.id}`);
      if (res.ok) {
        const fullLead = await res.json();
        setSelectedLead(fullLead);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleClosePanel = () => {
    setSelectedLead(null);
    setEditingMessage(null);
  };

  const handleMessageBlur = async () => {
    if (editingMessage === null || !selectedLead) return;
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/ai/update-lead-message`, {
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
      const res = await fetch(`http://${window.location.hostname}:3001/api/leads/${selectedLead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedLead(prev => prev ? { ...prev, status: updated.status } : null);
        setLeads(prev => prev.map(l => l.id === updated.id ? { ...l, status: updated.status } : l));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleExportCsv = () => {
    window.location.href = '/api/leads/export/csv';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1>Лиды / CRM</h1>
          <div className="text-sm text-secondary" style={{ marginTop: '4px' }}>Всего лидов: {leads.length}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={handleExportCsv}>📥 Экспорт CSV</button>
          <button className="btn btn-primary">Новая кампания</button>
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
                  </tr>
                ))}
                {!loading && leads.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>
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
                <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, margin: 0 }}>
                  {selectedLead.name || 'Без имени'} 
                  {selectedLead.platform === 'instagram' && (
                    <span style={{ marginLeft: '8px', fontSize: '14px', background: '#e1306c', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>IG</span>
                  )}
                </h2>
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
              <button className="btn btn-ghost" onClick={handleClosePanel} style={{ padding: '4px 8px' }}>✕</button>
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

              {/* Tags */}
              <div>
                <label className="form-label">Теги</label>
                <div className="tag-list mb-2">
                  {(selectedLead.tags || []).map(tag => (
                    <span key={tag} className="tag">
                      {tag} ✕
                    </span>
                  ))}
                  {(!selectedLead.tags || selectedLead.tags.length === 0) && <span className="text-xs text-secondary">Нет тегов</span>}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="form-label">Заметки</label>
                <textarea className="form-textarea" rows={3} defaultValue={selectedLead.notes} placeholder="Напишите что-то о лиде..." />
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
    </div>
  );
}
