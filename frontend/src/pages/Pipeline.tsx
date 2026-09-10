import React, { useState, useEffect, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { LeadDetailPanel } from '../components/LeadDetailPanel';

interface Lead {
  id: number;
  name: string;
  phone: string;
  status: string;
  title: string;
  city: string;
  website?: string;
  niche?: string | null;
  owner?: string | null;
  source_url?: string | null;
  platform?: string | null;
  agreement_status?: 'green' | 'red' | null;
}

const COLUMNS = [
  { id: 'new', title: 'New', color: '#64748B' },
  { id: 'call', title: 'Звонок', color: '#7C3AED' },
  { id: 'interested', title: 'Интерес', color: 'var(--color-warning)' },
  { id: 'meeting_scheduled', title: 'Встреча назначена', color: '#0EA5E9' },
  { id: 'meeting_done', title: 'Встреча проведена', color: '#6366F1' },
  { id: 'proposal', title: 'КП', color: '#F59E0B' },
  { id: 'deal', title: 'Сделка', color: 'var(--color-success)' },
];

const ALL_NICHES = '__all__';

export function Pipeline() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [niches, setNiches] = useState<string[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [activeNiche, setActiveNiche] = useState<string>(ALL_NICHES);
  const [showAddNiche, setShowAddNiche] = useState(false);
  const [newNicheText, setNewNicheText] = useState('');
  const [savingNiche, setSavingNiche] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [total, setTotal] = useState(0);

  const selectedLead = useMemo(
    () => leads.find(l => l.id === selectedLeadId) || null,
    [leads, selectedLeadId]
  );

  const handleLeadUpdated = (updated: Lead) => {
    // Лид сменил нишу и больше не принадлежит открытой воронке — убираем из доски
    if (activeNiche !== ALL_NICHES && (updated.niche || '') !== activeNiche) {
      setLeads(prev => prev.filter(l => l.id !== updated.id));
      setTotal(t => Math.max(0, t - 1));
      setSelectedLeadId(null);
      return;
    }
    setLeads(prev => prev.map(l => (l.id === updated.id ? { ...l, ...updated } : l)));
  };

  const handleLeadDeleted = (leadId: number) => {
    setLeads(prev => prev.filter(l => l.id !== leadId));
    setTotal(t => Math.max(0, t - 1));
    setSelectedLeadId(null);
  };

  const fetchNiches = () => {
    fetch('/api/leads/niches')
      .then(r => r.json())
      .then(d => setNiches(d.niches || []))
      .catch(e => console.error(e));
  };

  const fetchOwners = () => {
    fetch('/api/leads/owners')
      .then(r => r.json())
      .then(d => setOwners(d.owners || []))
      .catch(e => console.error(e));
  };

  const fetchLeads = () => {
    setLoading(true);
    const qs = activeNiche === ALL_NICHES ? '' : `&niche=${encodeURIComponent(activeNiche)}`;
    fetch(`/api/leads?limit=2000${qs}`)
      .then(r => r.json())
      .then(data => {
        setLeads(data.leads || []);
        setTotal(typeof data.total === 'number' ? data.total : (data.leads || []).length);
        setLoading(false);
      })
      .catch(e => {
        console.error(e);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchNiches();
    fetchOwners();
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [activeNiche]);

  // Фильтрация по нише делается на сервере; здесь только страховка от рассинхрона
  const visibleLeads = useMemo(() => {
    if (activeNiche === ALL_NICHES) return leads;
    return leads.filter(l => (l.niche || '') === activeNiche);
  }, [leads, activeNiche]);

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const leadId = Number(draggableId);
    const newStatus = destination.droppableId;

    // Optimistic UI update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));

    // Persist
    try {
      await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  const handleAddNiche = async () => {
    const value = newNicheText.trim();
    if (!value || savingNiche) return;
    setSavingNiche(true);
    try {
      const nextPresets = Array.from(new Set([...niches, value]));
      const res = await fetch('/api/leads/niches', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niches: nextPresets })
      });
      if (res.ok) {
        setNiches(nextPresets);
        setActiveNiche(value);
        setNewNicheText('');
        setShowAddNiche(false);
      }
    } catch (err) {
      console.error('Failed to save niche', err);
    } finally {
      setSavingNiche(false);
    }
  };

  const getLeadsByStatus = (status: string) => visibleLeads.filter(l => l.status === status);

  if (loading) return <div className="p-8 text-secondary">Загрузка воронки...</div>;

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0, overflow: 'hidden' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Воронка продаж</h1>
          <div className="text-secondary mt-1">
            Канбан-доска по нишам — выберите нишу, чтобы увидеть её воронку
            {' · '}
            {activeNiche === ALL_NICHES ? 'всего лидов' : `в воронке «${activeNiche}»`}: <b>{total}</b>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ flex: '0 0 auto', paddingTop: '16px', paddingBottom: 0 }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px' }}>
          <button
            className="btn"
            onClick={() => setActiveNiche(ALL_NICHES)}
            style={{
              backgroundColor: activeNiche === ALL_NICHES ? 'var(--color-primary)' : 'var(--color-surface-alt)',
              color: activeNiche === ALL_NICHES ? '#fff' : 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-weak)'
            }}
          >
            Все ниши
          </button>
          {niches.map(n => (
            <button
              key={n}
              className="btn"
              onClick={() => setActiveNiche(n)}
              style={{
                backgroundColor: activeNiche === n ? 'var(--color-primary)' : 'var(--color-surface-alt)',
                color: activeNiche === n ? '#fff' : 'var(--color-text-secondary)',
                border: '1px solid var(--color-border-weak)'
              }}
            >
              {n}
            </button>
          ))}

          {!showAddNiche ? (
            <button className="btn btn-ghost" onClick={() => setShowAddNiche(true)}>➕ Ниша</button>
          ) : (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                className="form-input"
                autoFocus
                style={{ width: '160px' }}
                value={newNicheText}
                onChange={e => setNewNicheText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddNiche(); if (e.key === 'Escape') setShowAddNiche(false); }}
                placeholder="Название ниши"
              />
              <button className="btn btn-primary" onClick={handleAddNiche} disabled={!newNicheText.trim() || savingNiche}>
                {savingNiche ? '...' : 'OK'}
              </button>
              <button className="btn btn-ghost" onClick={() => { setShowAddNiche(false); setNewNicheText(''); }}>✕</button>
            </div>
          )}
        </div>
      </div>

      <div className="page-body" style={{ flex: 1, overflowX: 'auto', minHeight: 0, paddingTop: 0, paddingBottom: '16px' }}>
        <DragDropContext onDragEnd={onDragEnd}>
          <div style={{ display: 'flex', gap: '20px', height: '100%', alignItems: 'stretch' }}>
            {COLUMNS.map(column => {
              const columnLeads = getLeadsByStatus(column.id);

              return (
                <div key={column.id} style={{
                  flex: '0 0 280px',
                  backgroundColor: 'var(--color-bg)',
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  minHeight: 0,
                  border: '1px solid var(--color-border-weak)'
                }}>
                  <div style={{
                    padding: '16px',
                    borderBottom: '1px solid var(--color-border-weak)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontWeight: 600
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: column.color }} />
                      {column.title}
                    </div>
                    <span className="badge" style={{ backgroundColor: 'var(--color-surface-alt)', color: 'var(--color-text-secondary)' }}>
                      {columnLeads.length}
                    </span>
                  </div>

                  <Droppable droppableId={column.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        style={{
                          padding: '16px',
                          flex: 1,
                          overflowY: 'auto',
                          minHeight: '150px',
                          backgroundColor: snapshot.isDraggingOver ? 'var(--color-surface-alt)' : 'transparent',
                          transition: 'background-color 0.2s ease'
                        }}
                      >
                        {columnLeads.map((lead, index) => (
                          <Draggable key={lead.id} draggableId={lead.id.toString()} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className="card"
                                onClick={() => { if (!snapshot.isDragging) setSelectedLeadId(lead.id); }}
                                style={{
                                  padding: '16px',
                                  marginBottom: '12px',
                                  cursor: 'pointer',
                                  boxShadow: snapshot.isDragging ? '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)' : 'var(--shadow-sm)',
                                  ...provided.draggableProps.style
                                }}
                              >
                                <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '4px' }}>
                                  {lead.name || 'Без имени'}
                                </div>
                                <div className="mono text-xs text-secondary mb-3">{lead.phone}</div>

                                <div style={{ fontSize: '13px', color: 'var(--color-text-primary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                  {lead.title}
                                </div>

                                {activeNiche === ALL_NICHES && lead.niche && (
                                  <span className="badge" style={{ marginTop: '8px', display: 'inline-block', backgroundColor: 'var(--color-surface-alt)', color: 'var(--color-text-secondary)', fontSize: '11px' }}>
                                    {lead.niche}
                                  </span>
                                )}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      </div>

      {selectedLead && (
        <LeadDetailPanel
          lead={selectedLead}
          niches={niches}
          owners={owners}
          onOwnersChanged={setOwners}
          onLeadDeleted={handleLeadDeleted}
          onClose={() => setSelectedLeadId(null)}
          onLeadUpdated={updated => handleLeadUpdated({ ...selectedLead, ...updated })}
        />
      )}
    </div>
  );
}
