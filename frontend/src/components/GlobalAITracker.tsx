import React, { useState, useEffect } from 'react';
import { socket } from '../services/socket';

export const GlobalAITracker = () => {
  const [status, setStatus] = useState<{ total: number, done: number, errors: number, active: boolean } | null>(null);

  useEffect(() => {
    // Initial fetch to check if generation is already running
    fetch(`http://${window.location.hostname}:3001/api/ai/status`)
      .then(res => res.json())
      .then(data => {
        if (data && data.active) {
          setStatus(data);
        }
      })
      .catch(console.error);

    const handleStarted = (data: any) => {
      setStatus(data);
    };

    const handleGenerated = () => {
      setStatus(prev => prev ? { ...prev, done: prev.done + 1 } : null);
    };

    const handleError = () => {
      setStatus(prev => prev ? { ...prev, errors: prev.errors + 1 } : null);
    };

    const handleBatchDone = () => {
      setTimeout(() => setStatus(null), 3000); // Clear after 3 seconds
    };

    socket.on('ai:started', handleStarted);
    socket.on('ai:generated', handleGenerated);
    socket.on('ai:error', handleError);
    socket.on('ai:batch-done', handleBatchDone);

    return () => {
      socket.off('ai:started', handleStarted);
      socket.off('ai:generated', handleGenerated);
      socket.off('ai:error', handleError);
      socket.off('ai:batch-done', handleBatchDone);
    };
  }, []);

  if (!status) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      backgroundColor: '#fff',
      padding: '16px 20px',
      borderRadius: '12px',
      boxShadow: '0 10px 25px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05)',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      zIndex: 9999,
      animation: 'slideUp 0.3s ease-out forwards'
    }}>
      <div style={{
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        backgroundColor: '#10B981',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: '18px'
      }} className="animate-pulse">
        🤖
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: '14px', color: '#111827' }}>
          Генерация текстов
        </div>
        <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '2px' }}>
          Готово: <b>{status.done}</b> из <b>{status.total}</b>
          {status.errors > 0 && <span style={{ color: '#EF4444', marginLeft: '6px' }}>(Ошибок: {status.errors})</span>}
        </div>
      </div>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};
