import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

interface Lead {
  id: number;
  name: string;
  phone: string;
  status: string;
  title: string;
  city: string;
}

const COLUMNS = [
  { id: 'replied', title: 'Ответили', color: '#7C3AED' },
  { id: 'interested', title: 'Интерес', color: 'var(--color-warning)' },
  { id: 'deal', title: 'Сделка', color: 'var(--color-success)' },
  { id: 'refused', title: 'Отказ', color: 'var(--color-error)' },
];

export function Pipeline() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`http://${window.location.hostname}:3001/api/leads?limit=1000`)
      .then(r => r.json())
      .then(data => {
        // Filter out only pipeline-relevant leads
        const pipelineLeads = (data.leads || []).filter((l: Lead) => 
          ['replied', 'interested', 'deal', 'refused'].includes(l.status)
        );
        setLeads(pipelineLeads);
        setLoading(false);
      })
      .catch(e => {
        console.error(e);
        setLoading(false);
      });
  }, []);

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
      await fetch(`http://${window.location.hostname}:3001/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  const getLeadsByStatus = (status: string) => leads.filter(l => l.status === status);

  if (loading) return <div className="p-8 text-secondary">Загрузка воронки...</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <h1 className="page-title">Воронка продаж</h1>
          <div className="text-secondary mt-1">Канбан-доска для ведения активных сделок</div>
        </div>
      </div>

      <div className="page-body" style={{ flex: 1, overflowX: 'auto', minHeight: 0 }}>
        <DragDropContext onDragEnd={onDragEnd}>
          <div style={{ display: 'flex', gap: '20px', height: '100%', alignItems: 'flex-start' }}>
            {COLUMNS.map(column => {
              const columnLeads = getLeadsByStatus(column.id);
              
              return (
                <div key={column.id} style={{ 
                  flex: '0 0 300px', 
                  backgroundColor: 'var(--color-bg)', 
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  maxHeight: '100%',
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
                                style={{
                                  padding: '16px',
                                  marginBottom: '12px',
                                  cursor: 'grab',
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
    </div>
  );
}
