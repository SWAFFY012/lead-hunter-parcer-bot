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

interface Stage {
  id: string;
  title: string;
  color: string;
  orphan?: boolean;
}

const ALL_NICHES = '__all__';

const STAGE_COLORS = ['#64748B', '#7C3AED', '#F59E0B', '#0EA5E9', '#6366F1', '#22C55E', '#EF4444', '#14B8A6'];

// Идентификатор стадии уходит в БД как значение status, поэтому оставляем
// только латиницу: русское название превращаем в транслит.
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

function makeStageId(title: string) {
  const base = title.toLowerCase().split('').map(ch => TRANSLIT[ch] ?? ch).join('');
  return base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `stage_${Date.now()}`;
}

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
  const [stages, setStages] = useState<Stage[]>([]);
  const [editStages, setEditStages] = useState(false);
  const [savingStages, setSavingStages] = useState(false);

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

  const fetchStages = () => {
    fetch('/api/leads/stages')
      .then(r => r.json())
      .then(d => setStages(d.stages || []))
      .catch(e => console.error(e));
  };

  // Сохраняем без колонок-сирот: они существуют лишь пока на них висят лиды.
  const saveStages = async (next: Stage[]) => {
    setStages(next);
    setSavingStages(true);
    try {
      await fetch('/api/leads/stages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages: next.filter(st => !st.orphan).map(({ id, title, color }) => ({ id, title, color })) })
      });
    } catch (err) {
      console.error('Failed to save stages', err);
    } finally {
      setSavingStages(false);
    }
  };

  const addStage = () => {
    const title = window.prompt('Название колонки');
    if (!title || !title.trim()) return;
    const id = makeStageId(title.trim());
    if (stages.some(st => st.id === id)) {
      window.alert('Колонка с таким названием уже есть');
      return;
    }
    saveStages([...stages, { id, title: title.trim(), color: STAGE_COLORS[stages.length % STAGE_COLORS.length] }]);
  };

  const renameStage = (stage: Stage) => {
    const title = window.prompt('Новое название', stage.title);
    if (!title || !title.trim()) return;
    // Идентификатор не трогаем: он записан в status у лидов этой колонки.
    saveStages(stages.map(st => (st.id === stage.id ? { ...st, title: title.trim() } : st)));
  };

  const recolorStage = (stage: Stage) => {
    const at = STAGE_COLORS.indexOf(stage.color);
    const color = STAGE_COLORS[(at + 1) % STAGE_COLORS.length];
    saveStages(stages.map(st => (st.id === stage.id ? { ...st, color } : st)));
  };

  const removeStage = async (stage: Stage) => {
    const count = leads.filter(l => l.status === stage.id).length;
    const rest = stages.filter(st => st.id !== stage.id && !st.orphan);
    if (rest.length === 0) {
      window.alert('Последнюю колонку удалить нельзя');
      return;
    }
    // Лиды удалённой стадии иначе исчезли бы с доски — переносим их в первую.
    if (count > 0) {
      const target = rest[0];
      if (!window.confirm(`В колонке «${stage.title}» ${count} лид(ов). Перенести их в «${target.title}» и удалить колонку?`)) return;
      try {
        await fetch('/api/leads/stages/move', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: stage.id, to: target.id })
        });
      } catch (err) {
        console.error('Failed to move leads', err);
        return;
      }
      setLeads(prev => prev.map(l => (l.status === stage.id ? { ...l, status: target.id } : l)));
    } else if (!window.confirm(`Удалить колонку «${stage.title}»?`)) {
      return;
    }
    saveStages(stages.filter(st => st.id !== stage.id));
  };

  const moveStage = (index: number, delta: number) => {
    const next = [...stages];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    saveStages(next);
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
    fetchStages();
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

          <div style={{ width: '1px', alignSelf: 'stretch', backgroundColor: 'var(--color-border-weak)', margin: '0 4px' }} />

          <button className="btn btn-ghost" onClick={addStage} disabled={savingStages}>➕ Колонка</button>
          <button
            className="btn"
            onClick={() => setEditStages(v => !v)}
            style={{
              backgroundColor: editStages ? 'var(--color-primary)' : 'var(--color-surface-alt)',
              color: editStages ? '#fff' : 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-weak)'
            }}
          >
            {editStages ? '✓ Готово' : '✎ Колонки'}
          </button>
        </div>
      </div>

      <div className="page-body" style={{ flex: 1, overflowX: 'auto', minHeight: 0, paddingTop: 0, paddingBottom: '16px' }}>
        <DragDropContext onDragEnd={onDragEnd}>
          <div style={{ display: 'flex', gap: '20px', height: '100%', alignItems: 'stretch' }}>
            {stages.map((column, columnIndex) => {
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <div
                        onClick={() => { if (editStages && !column.orphan) recolorStage(column); }}
                        title={editStages && !column.orphan ? 'Сменить цвет' : undefined}
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          backgroundColor: column.color,
                          flexShrink: 0,
                          cursor: editStages && !column.orphan ? 'pointer' : 'default'
                        }}
                      />
                      <span
                        onClick={() => { if (editStages && !column.orphan) renameStage(column); }}
                        title={editStages && !column.orphan ? 'Переименовать' : undefined}
                        style={{
                          cursor: editStages && !column.orphan ? 'pointer' : 'default',
                          textDecoration: editStages && !column.orphan ? 'underline dotted' : 'none',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {column.title}
                      </span>
                    </div>

                    {editStages && !column.orphan ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '2px 6px' }}
                          title="Влево"
                          disabled={columnIndex === 0 || savingStages}
                          onClick={() => moveStage(columnIndex, -1)}
                        >◀</button>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '2px 6px' }}
                          title="Вправо"
                          disabled={columnIndex === stages.length - 1 || savingStages}
                          onClick={() => moveStage(columnIndex, 1)}
                        >▶</button>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '2px 6px', color: 'var(--color-danger, #EF4444)' }}
                          title="Удалить колонку"
                          disabled={savingStages}
                          onClick={() => removeStage(column)}
                        >🗑</button>
                      </div>
                    ) : (
                      <span className="badge" style={{ backgroundColor: 'var(--color-surface-alt)', color: 'var(--color-text-secondary)', flexShrink: 0 }}>
                        {columnLeads.length}
                      </span>
                    )}
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
