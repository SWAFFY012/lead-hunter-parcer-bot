import React, { useState, useEffect } from 'react';
import { socket } from '../services/socket';

interface Campaign {
  id: number;
  name: string;
  created_at: string;
  source_url: string;
  prompt_id?: number | null;
}

interface Lead {
  id: number;
  phone: string;
  wa_phone: string;
  name: string;
  title: string;
  ad_text: string;
  source_url: string;
  created_at: string;
  campaign_id: number;
  status: 'new' | 'ready_to_send' | 'sent' | 'replied' | 'interested' | 'deal' | 'refused';
  ai_message?: string;
}

interface Prompt {
  id: number;
  name: string;
  model_name: string;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Новый',
  ready_to_send: 'Готов (AI)',
  sent: 'Отправлено',
  replied: 'Ответил',
  interested: 'В очереди / Интерес',
  deal: 'Сделка',
  refused: 'Ошибка / Отказ'
};

const STATUS_CLASSES: Record<string, string> = {
  new: 'badge-new',
  ready_to_send: 'badge-online',
  sent: 'badge-sent',
  replied: 'badge-replied',
  interested: 'badge-online',
  deal: 'badge-online',
  refused: 'badge-new' // reuse grey or style it red later
};

export function ManualBases() {
  const [bases, setBases] = useState<Campaign[]>([]);
  const [selectedBase, setSelectedBase] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBaseName, setNewBaseName] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [selectedLeadDetails, setSelectedLeadDetails] = useState<Lead | null>(null);

  // AI Gen States
  const [selectedLeads, setSelectedLeads] = useState<Set<number>>(new Set());
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<number | ''>('');
  const [generatingStatus, setGeneratingStatus] = useState<{ total: number, done: number, errors: number } | null>(null);
  const [editingMessages, setEditingMessages] = useState<Record<number, string>>({});
  const [modalMessage, setModalMessage] = useState<{leadId: number, message: string} | null>(null);
  const [isBasesOpen, setIsBasesOpen] = useState(true);

  // Helper for OLX URLs
  const formatOlxUrl = (url: string) => {
    try {
      if (!url) return 'Нет ссылки';
      const u = new URL(url);
      let path = u.pathname;
      path = path.replace(/^\/d\/uk\//, '');
      path = path.replace(/^\/d\//, '');
      path = path.replace(/^\/+/, ''); // remove leading slash
      return path;
    } catch (e) {
      return url || 'Нет ссылки';
    }
  };

  const fetchPrompts = async () => {
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/ai/prompts`);
      if (res.ok) setPrompts(await res.json());
    } catch (err) { console.error(err); }
  };

  const fetchBases = async () => {
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/campaigns`);
      if (res.ok) {
        const data: Campaign[] = await res.json();
        setBases(data.filter(c => c.name.startsWith('(+)')));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeads = async (campaignId: number) => {
    setLeadsLoading(true);
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/leads?campaign_id=${campaignId}`);
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLeadsLoading(false);
    }
  };

  useEffect(() => {
    fetchBases();
    fetchPrompts();
  }, []);

  const handleCreateBase = async () => {
    if (!newBaseName.trim()) return;
    setCreating(true);
    try {
      const response = await fetch(`http://${window.location.hostname}:3001/api/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newBaseName.trim(), source_url: newBaseUrl.trim(), is_manual: true })
      });
      if (response.ok) {
        const campaign = await response.json();
        setBases([campaign, ...bases]);
        setNewBaseName('');
        setNewBaseUrl('');
        setSelectedBase(campaign);
        setIsBasesOpen(false);
      } else {
        alert('Ошибка при создании базы');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка при создании базы');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (selectedBase) {
      fetchLeads(selectedBase.id);
      setSelectedPromptId(selectedBase.prompt_id || '');
    } else {
      setLeads([]);
      setSelectedPromptId('');
    }
  }, [selectedBase]);

  // Real-time updates for leads and AI
  useEffect(() => {
    const handleNewLead = (data: { lead: Lead }) => {
      if (selectedBase && data.lead.campaign_id === selectedBase.id) {
        setLeads(prev => [data.lead, ...prev]);
      }
    };
    
    const handleAiGenerated = (data: { leadId: number, message: string }) => {
      setLeads(prev => prev.map(l => l.id === data.leadId ? { ...l, ai_message: data.message } : l));
      setEditingMessages(prev => {
        const next = { ...prev };
        delete next[data.leadId]; // Clear local edits when new text arrives
        return next;
      });
    };

    socket.on('manual_parser:lead', handleNewLead);
    socket.on('ai:generated', handleAiGenerated);

    return () => {
      socket.off('manual_parser:lead', handleNewLead);
      socket.off('ai:generated', handleAiGenerated);
    };
  }, [selectedBase]);

  const handleDelete = async (id: number) => {
    if (!confirm('Вы уверены, что хотите удалить эту базу? Все лиды внутри нее будут удалены!')) return;
    try {
      await fetch(`http://${window.location.hostname}:3001/api/campaigns/${id}`, { method: 'DELETE' });
      setBases(bases.filter(b => b.id !== id));
      if (selectedBase?.id === id) setSelectedBase(null);
    } catch (err) {
      alert('Ошибка при удалении базы');
    }
  };

  const handleStatusChange = async (leadId: number, newStatus: string) => {
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        setLeads(leads.map(l => l.id === leadId ? { ...l, status: newStatus as any } : l));
      } else {
        alert('Ошибка обновления статуса');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка сети при обновлении статуса');
    }
  };

  const handleDeleteLead = async (leadId: number) => {
    if (!confirm('Удалить лид?')) return;
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/leads/${leadId}`, { method: 'DELETE' });
      if (res.ok) {
        setLeads(leads.filter(l => l.id !== leadId));
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка удаления лида');
    }
  };

  const exportCSV = () => {
    if (leads.length === 0) return alert('Нет лидов для экспорта');
    
    // Create CSV header
    const headers = ['Имя', 'Телефон', 'Заголовок', 'Ссылка', 'Описание', 'Дата'];
    
    // Create rows
    const rows = leads.map(l => {
      return [
        `"${(l.name || '').replace(/"/g, '""')}"`,
        `"${l.phone}"`,
        `"${(l.title || '').replace(/"/g, '""')}"`,
        `"${l.source_url || ''}"`,
        `"${(l.ad_text || '').replace(/"/g, '""')}"`,
        `"${new Date(l.created_at).toLocaleString()}"`
      ].join(',');
    });
    
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${selectedBase?.name || 'leads'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleLeadSelection = (id: number) => {
    const next = new Set(selectedLeads);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedLeads(next);
  };

  const toggleAllSelection = () => {
    if (selectedLeads.size === leads.filter(l => l.status !== 'ready_to_send').length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(leads.filter(l => l.status !== 'ready_to_send').map(l => l.id)));
    }
  };

  const handleGenerate = async () => {
    if (selectedLeads.size === 0) return alert('Выберите лиды для генерации');
    if (!selectedPromptId) return alert('Выберите шаблон');

    try {
      // Clear UI immediately
      setLeads(leads.map(l => selectedLeads.has(l.id) ? { ...l, ai_message: '' } : l));
      setEditingMessages(prev => {
        const next = { ...prev };
        for (const id of selectedLeads) {
          next[id] = '';
        }
        return next;
      });

      const res = await fetch(`http://${window.location.hostname}:3001/api/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: Array.from(selectedLeads), promptId: selectedPromptId })
      });
      
      if (!res.ok) throw new Error('Generation failed');
      const data = await res.json();
      
      // For Ollama (synchronous) or backend immediate responses
      if (data.results) {
        setLeads(leads.map(l => {
          const result = data.results.find((r: any) => r.leadId === l.id);
          if (result && result.message) {
            return { ...l, ai_message: result.message };
          }
          return l;
        }));
      }
      setSelectedLeads(new Set());
    } catch (err) {
      console.error(err);
      alert('Ошибка при генерации');
    }
  };

  const handleMessageEdit = (id: number, text: string) => {
    setEditingMessages(prev => ({ ...prev, [id]: text }));
  };

  const handleMessageBlur = async (id: number) => {
    const newText = editingMessages[id];
    if (newText === undefined) return;
    
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/ai/update-lead-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: id, ai_message: newText })
      });
      if (res.ok) {
        setLeads(leads.map(l => l.id === id ? { ...l, ai_message: newText } : l));
        // Remove from editing state once saved
        const next = { ...editingMessages };
        delete next[id];
        setEditingMessages(next);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleApproveMessage = async (id: number) => {
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/ai/update-lead-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: id, status: 'ready_to_send' })
      });
      if (res.ok) {
        setLeads(prev => prev.map(l => l.id === id ? { ...l, status: 'ready_to_send' as any } : l));
        if (selectedLeads.has(id)) {
          setSelectedLeads(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUnapproveMessage = async (id: number) => {
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/ai/update-lead-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: id, status: 'new' })
      });
      if (res.ok) {
        setLeads(prev => prev.map(l => l.id === id ? { ...l, status: 'new' as any } : l));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleApproveSelected = async () => {
    if (selectedLeads.size === 0) return;
    try {
      await Promise.all(
        Array.from(selectedLeads).map(id =>
          fetch(`http://${window.location.hostname}:3001/api/ai/update-lead-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadId: id, status: 'ready_to_send' })
          })
        )
      );
      
      setLeads(prev => prev.map(l => selectedLeads.has(l.id) ? { ...l, status: 'ready_to_send' as any } : l));
      setSelectedLeads(new Set());
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ручные базы (Anti-Ban)</h1>
          <div className="text-secondary mt-1">Управление базами собранными через расширение</div>
        </div>
      </div>

      <div className="page-body flex flex-col gap-4 h-full" style={{ position: 'relative' }}>
        
        {/* Collapsible Bases List */}
        <div className="card" style={{ padding: '0' }}>
          <div 
            style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: 'var(--color-bg-secondary)', borderBottom: isBasesOpen ? '1px solid var(--color-border-weak)' : 'none' }}
            onClick={() => setIsBasesOpen(!isBasesOpen)}
          >
            <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              📁 Базы {selectedBase ? `(Выбрана: ${selectedBase.name})` : '(Не выбрана)'}
            </div>
            <div className="text-sm font-medium text-secondary">{isBasesOpen ? 'Скрыть ▲' : 'Развернуть ▼'}</div>
          </div>
          
          {isBasesOpen && (
            <div style={{ padding: '16px' }}>
              <div className="flex gap-4 mb-4">
                <input 
                  type="text" 
                  className="form-input"
                  style={{ flex: 1, maxWidth: '300px' }}
                  placeholder="Название базы..."
                  value={newBaseName}
                  onChange={e => setNewBaseName(e.target.value)}
                  disabled={creating}
                />
                <input 
                  type="text" 
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="Ссылка на источник (OLX, Google Maps)..."
                  value={newBaseUrl}
                  onChange={e => setNewBaseUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateBase()}
                  disabled={creating}
                />
                <button 
                  className="btn btn-primary" 
                  onClick={handleCreateBase}
                  disabled={creating || !newBaseName.trim()}
                >
                  + Создать
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {loading ? (
                  <div className="p-2 text-secondary text-sm">Загрузка...</div>
                ) : bases.length === 0 ? (
                  <div className="p-2 text-secondary text-sm">Нет баз. Создайте базу.</div>
                ) : (
                  bases.map(base => (
                    <div 
                      key={base.id}
                      onClick={() => { setSelectedBase(base); setIsBasesOpen(false); }}
                      style={{
                        padding: '6px 12px',
                        border: '1px solid var(--color-border-weak)',
                        borderRadius: '16px',
                        cursor: 'pointer',
                        background: selectedBase?.id === base.id ? '#10B981' : '#fff',
                        color: selectedBase?.id === base.id ? '#fff' : 'inherit',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '13px',
                        transition: 'all 0.2s'
                      }}
                      className="hover:border-emerald-500"
                    >
                      <span style={{ fontWeight: selectedBase?.id === base.id ? 600 : 400 }}>{base.name}</span>
                      <span style={{ 
                        background: selectedBase?.id === base.id ? 'rgba(255,255,255,0.25)' : 'var(--color-bg-secondary)', 
                        padding: '2px 6px', 
                        borderRadius: '10px', 
                        fontSize: '11px',
                        color: selectedBase?.id === base.id ? '#fff' : 'var(--color-text-secondary)'
                      }}>
                        {(base as any).leadsCount || 0}
                      </span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDelete(base.id); }}
                        style={{ background: 'none', border: 'none', color: selectedBase?.id === base.id ? '#fff' : 'var(--color-error)', cursor: 'pointer', opacity: 0.7, padding: '0 0 0 4px' }}
                        title="Удалить базу"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Leads table */}
        <div className="card flex flex-col h-full" style={{ overflow: 'hidden' }}>
          {selectedBase ? (
            <>
              <div className="flex flex-col gap-2 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded border border-gray-200">
                      <select 
                        className="form-input text-sm py-1 px-2"
                        value={selectedPromptId}
                        onChange={async e => {
                          const newPromptId = Number(e.target.value) || '';
                          setSelectedPromptId(newPromptId);
                          if (selectedBase) {
                            try {
                              await fetch(`http://${window.location.hostname}:3001/api/campaigns/${selectedBase.id}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ prompt_id: newPromptId || null })
                              });
                              setBases(bases.map(b => b.id === selectedBase.id ? { ...b, prompt_id: newPromptId || null } : b));
                              setSelectedBase({ ...selectedBase, prompt_id: newPromptId || null });
                            } catch (err) {
                              console.error('Failed to update base prompt_id', err);
                            }
                          }
                        }}
                        style={{ minWidth: '180px' }}
                      >
                        <option value="">-- Выберите шаблон --</option>
                        {prompts.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    {selectedBase.source_url && (
                      <div className="text-xs text-secondary bg-slate-50 px-2 py-1 rounded border border-slate-100 flex items-center gap-1">
                        <span>🔗 Источник:</span>
                        <a href={selectedBase.source_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline break-all" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selectedBase.source_url}
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 items-center">
                    <button className="btn btn-secondary" onClick={() => fetchLeads(selectedBase.id)}>Обновить</button>
                    <button className="btn btn-secondary" onClick={exportCSV}>Экспорт CSV</button>
                    <button 
                      className="btn btn-secondary"
                      disabled={selectedLeads.size === 0}
                      onClick={handleApproveSelected}
                      title="Утвердить выделенные лиды (перевести в ready_to_send)"
                    >
                      ✅ Утвердить ({selectedLeads.size})
                    </button>
                    <button 
                      className="btn btn-primary"
                      disabled={selectedLeads.size === 0 || !selectedPromptId}
                      onClick={handleGenerate}
                    >
                      {`🤖 Сгенерировать (${selectedLeads.size})`}
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="table-container" style={{ flex: 1, overflowY: 'auto' }}>
                <table style={{ margin: 0, fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '30px', textAlign: 'center', padding: '8px 4px' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedLeads.size > 0 && selectedLeads.size === leads.filter(l => l.status !== 'ready_to_send').length}
                          onChange={toggleAllSelection}
                          disabled={leads.filter(l => l.status !== 'ready_to_send').length === 0}
                        />
                      </th>
                      <th style={{ padding: '8px 12px' }}>Имя</th>
                      <th style={{ padding: '8px 12px' }}>Телефон</th>
                      <th style={{ padding: '8px 12px' }}>Статус</th>
                      <th style={{ padding: '8px 12px' }}>Заголовок</th>
                      <th style={{ width: '250px', padding: '8px 12px' }}>Текст</th>
                      <th style={{ width: '100px', textAlign: 'center', padding: '8px 12px' }}>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadsLoading ? (
                      <tr><td colSpan={8} className="text-center py-8">Загрузка лидов...</td></tr>
                    ) : leads.length === 0 ? (
                      <tr><td colSpan={8} className="text-center text-secondary py-8">База пуста. Выделите номер на OLX и нажмите Cmd+1.</td></tr>
                    ) : (
                      leads.map((lead, i) => (
                        <tr 
                          key={lead.id || i}
                          onClick={() => setSelectedLeadDetails(lead)}
                          style={{ cursor: 'pointer', backgroundColor: selectedLeadDetails?.id === lead.id ? 'var(--color-surface-alt)' : undefined }}
                        >
                          <td style={{ textAlign: 'center', padding: '8px 4px' }} onClick={e => e.stopPropagation()}>
                            <input 
                              type="checkbox" 
                              checked={selectedLeads.has(lead.id)}
                              onChange={() => toggleLeadSelection(lead.id)}
                              disabled={lead.status === 'ready_to_send'}
                            />
                          </td>
                          <td style={{ padding: '8px 12px' }}><div style={{ fontWeight: 500 }}>{lead.name || 'Без имени'}</div></td>
                          <td style={{ padding: '8px 12px' }}><span className="mono" style={{ fontSize: '12px', opacity: 0.7 }}>{lead.phone}</span></td>
                          <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-2">
                              <span className={`badge ${STATUS_CLASSES[lead.status] || 'badge-new'}`} style={{ fontSize: '11px', padding: '2px 6px' }}>
                                {STATUS_LABELS[lead.status] || lead.status}
                              </span>
                              <select 
                                value={lead.status}
                                onChange={(e) => handleStatusChange(lead.id, e.target.value)}
                                style={{
                                  opacity: 0, 
                                  position: 'absolute', 
                                  width: '20px', 
                                  cursor: 'pointer'
                                }}
                                title="Изменить статус"
                              >
                                {Object.entries(STATUS_LABELS).map(([val, label]) => (
                                  <option key={val} value={val}>{label}</option>
                                ))}
                              </select>
                              <span style={{ fontSize: '10px', cursor: 'pointer', opacity: 0.5 }}>▼</span>
                            </div>
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ fontSize: '12px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }} title={lead.title || 'Нет заголовка'} onClick={e => e.stopPropagation()}>
                              <a href={lead.source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 500 }}>
                                {lead.title || formatOlxUrl(lead.source_url)}
                              </a>
                            </div>
                          </td>
                          <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
                            <div style={{ position: 'relative' }}>
                              <textarea
                                className="form-input"
                                value={editingMessages[lead.id] !== undefined ? editingMessages[lead.id] : (lead.ai_message || '')}
                                onChange={e => handleMessageEdit(lead.id, e.target.value)}
                                onBlur={() => handleMessageBlur(lead.id)}
                                disabled={lead.status === 'ready_to_send'}
                                style={{
                                  width: '100%',
                                  minHeight: '40px',
                                  fontSize: '12px',
                                  padding: '4px 24px 4px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid var(--color-border-weak)',
                                  resize: 'none',
                                  background: lead.status === 'ready_to_send' ? 'var(--color-bg-secondary)' : '#fff'
                                }}
                                placeholder="Сгенерируйте или напишите текст..."
                              />
                              <button
                                onClick={() => setModalMessage({ leadId: lead.id, message: editingMessages[lead.id] !== undefined ? editingMessages[lead.id] : (lead.ai_message || '') })}
                                style={{
                                  position: 'absolute',
                                  top: '4px',
                                  right: '4px',
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  opacity: 0.5,
                                  fontSize: '14px'
                                }}
                                title="Распахнуть"
                              >
                                🔍
                              </button>
                            </div>
                          </td>
                          <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
                            <div className="flex flex-col gap-2">
                              {lead.status !== 'ready_to_send' ? (
                                <button 
                                  className="btn btn-primary"
                                  onClick={() => handleApproveMessage(lead.id)}
                                  style={{ padding: '4px 8px', fontSize: '11px', width: '100%' }}
                                >
                                  Утвердить
                                </button>
                              ) : (
                                <button 
                                  className="btn btn-secondary"
                                  onClick={() => handleUnapproveMessage(lead.id)}
                                  style={{ padding: '4px 8px', fontSize: '11px', width: '100%', color: '#6B7280' }}
                                >
                                  Снять утверждение
                                </button>
                              )}
                              <div className="flex items-center gap-2 justify-center mt-2">
                                <a 
                                  href={`https://wa.me/${lead.wa_phone || lead.phone.replace('+', '')}?text=${encodeURIComponent(lead.ai_message || '')}`} 
                                  target="_blank" 
                                  rel="noreferrer" 
                                  title="WhatsApp" 
                                  style={{ 
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: '28px', height: '28px', borderRadius: '6px', 
                                    backgroundColor: '#E8F9F0', color: '#25D366',
                                    textDecoration: 'none', transition: 'all 0.2s', border: '1px solid #D1F4E0'
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#25D366'; e.currentTarget.style.color = '#fff'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#E8F9F0'; e.currentTarget.style.color = '#25D366'; }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
                                </a>

                                <a 
                                  href={`viber://chat?number=${lead.wa_phone || lead.phone.replace('+', '')}`} 
                                  target="_blank" 
                                  rel="noreferrer" 
                                  title="Viber" 
                                  style={{ 
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: '28px', height: '28px', borderRadius: '6px', 
                                    backgroundColor: '#F0EEFD', color: '#7360F2',
                                    textDecoration: 'none', transition: 'all 0.2s', border: '1px solid #DFDBFA'
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#7360F2'; e.currentTarget.style.color = '#fff'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#F0EEFD'; e.currentTarget.style.color = '#7360F2'; }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.596 15.342c-.22-.38-.63-.58-1.07-.58-.33 0-.66.12-.93.36-1.57 1.4-3.84.45-6.19-1.9-2.35-2.35-3.29-4.61-1.9-6.19.46-.51.46-1.28-.01-1.78l-2.09-2.09c-.25-.25-.59-.39-.94-.39-.34 0-.69.13-.94.39l-1.07 1.07c-2.4 2.4-2.4 6.33 0 8.73l6.59 6.59c1.17 1.17 2.7 1.81 4.36 1.81 1.66 0 3.19-.64 4.36-1.81l1.07-1.07c.52-.52.52-1.37 0-1.89l-1.24-1.25zm1.5-12.75c-3.13-3.13-8.2-3.13-11.33 0-.52.52-.52 1.36 0 1.88.52.52 1.36.52 1.88 0 2.09-2.09 5.48-2.09 7.57 0 2.09 2.09 2.09 5.48 0 7.57-.52.52-.52 1.36 0 1.88.26.26.6.39.94.39s.68-.13.94-.39c3.12-3.12 3.12-8.2 0-11.33zm-4.71 4.71c-.52-.52-1.36-.52-1.88 0-.52.52-.52 1.36 0 1.88.52.52 1.36.52 1.88 0 .52-.51.52-1.36 0-1.88z"/></svg>
                                </a>

                                <a 
                                  href={`https://t.me/+${lead.wa_phone || lead.phone.replace('+', '')}`} 
                                  target="_blank" 
                                  rel="noreferrer" 
                                  title="Telegram" 
                                  style={{ 
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: '28px', height: '28px', borderRadius: '6px', 
                                    backgroundColor: '#E6F6FE', color: '#0088cc',
                                    textDecoration: 'none', transition: 'all 0.2s', border: '1px solid #D0EDFC'
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#0088cc'; e.currentTarget.style.color = '#fff'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#E6F6FE'; e.currentTarget.style.color = '#0088cc'; }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.94z"/></svg>
                                </a>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-secondary">
              Выберите базу слева для просмотра лидов
            </div>
          )}
        </div>

      </div>

      {/* Modal for full text editing */}
      {modalMessage && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="card" style={{ width: '600px', maxWidth: '90%', padding: '24px' }}>
            <h3 className="card-title mb-4">Редактирование сообщения</h3>
            <textarea
              className="form-input"
              style={{ width: '100%', height: '300px', resize: 'vertical', fontFamily: 'var(--font-mono)' }}
              value={modalMessage.message}
              onChange={e => setModalMessage({ ...modalMessage, message: e.target.value })}
            />
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-secondary" onClick={() => setModalMessage(null)}>Отмена</button>
              <button 
                className="btn btn-primary" 
                onClick={() => {
                  handleMessageEdit(modalMessage.leadId, modalMessage.message);
                  handleMessageBlur(modalMessage.leadId); // Save to server
                  setModalMessage(null);
                }}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Side Panel Overlay & Panel for Lead Details */}
      {selectedLeadDetails && (
        <>
          <div className="side-panel-overlay" onClick={() => setSelectedLeadDetails(null)} />
          <div className="side-panel">
            <div className="side-panel-header">
              <div>
                <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, margin: 0 }}>
                  {selectedLeadDetails.name || 'Без имени'}
                </h2>
                <div className="mono text-secondary text-sm" style={{ marginTop: '4px' }}>{selectedLeadDetails.phone}</div>
              </div>
              <button className="btn btn-ghost" onClick={() => setSelectedLeadDetails(null)} style={{ padding: '4px 8px' }}>✕</button>
            </div>
            
            <div className="side-panel-body">
              {/* Status block */}
              <div>
                <label className="form-label">Статус лида</label>
                <select 
                  className="form-select" 
                  value={selectedLeadDetails.status} 
                  onChange={e => {
                    handleStatusChange(selectedLeadDetails.id, e.target.value);
                    setSelectedLeadDetails(prev => prev ? { ...prev, status: e.target.value as any } : null);
                  }}
                >
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              {/* Source info */}
              <div>
                <label className="form-label">Источник (Объявление)</label>
                <div className="card" style={{ padding: '16px', backgroundColor: 'var(--color-bg)', boxShadow: 'none' }}>
                  <div style={{ fontWeight: 500, fontSize: 'var(--text-sm)', marginBottom: '4px' }}>{selectedLeadDetails.title}</div>
                  <div className="text-xs text-tertiary">
                    <a href={selectedLeadDetails.source_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
                      {selectedLeadDetails.source_url}
                    </a>
                  </div>
                </div>
              </div>

              {/* Ad Text */}
              {selectedLeadDetails.ad_text && (
                <div>
                  <label className="form-label">Текст объявления</label>
                  <div className="card" style={{ padding: '16px', backgroundColor: 'var(--color-bg)', boxShadow: 'none', maxHeight: '200px', overflowY: 'auto' }}>
                    <div style={{ fontSize: '13px', whiteSpace: 'pre-wrap' }}>{selectedLeadDetails.ad_text}</div>
                  </div>
                </div>
              )}

              {/* AI Message Preview */}
              <div>
                <label className="form-label">🤖 AI Сгенерированное сообщение</label>
                <textarea
                  className="form-input"
                  style={{ width: '100%', minHeight: '100px', resize: 'vertical' }}
                  value={editingMessages[selectedLeadDetails.id] !== undefined ? editingMessages[selectedLeadDetails.id] : (selectedLeadDetails.ai_message || '')}
                  onChange={e => handleMessageEdit(selectedLeadDetails.id, e.target.value)}
                  onBlur={() => handleMessageBlur(selectedLeadDetails.id)}
                  disabled={selectedLeadDetails.status === 'ready_to_send'}
                  placeholder="Сгенерируйте или напишите текст..."
                />
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
