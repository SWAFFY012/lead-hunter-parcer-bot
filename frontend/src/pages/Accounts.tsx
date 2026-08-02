import React, { useState, useEffect } from 'react';
import { socket } from '../services/socket';

interface Account {
  id: string;
  name: string;
  phone: string;
  status: 'offline' | 'online' | 'banned' | 'connecting';
  warmup_day: number;
  warmup_total_days: number;
  allow_sender: number | boolean;
  allow_warmup: number | boolean;
  is_trusted: number | boolean;
}

export function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAccId, setNewAccId] = useState('');
  const [qrCodeData, setQrCodeData] = useState<{id: string, qr: string} | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch accounts on mount
  useEffect(() => {
    fetchAccounts();

    // Socket listeners
    const handleStatus = (data: { id: string, status: string }) => {
      console.log('Status update:', data);
      setAccounts(prev => prev.map(acc => 
        acc.id === data.id ? { ...acc, status: data.status as any } : acc
      ));
      // Optionally re-fetch to get updated name/phone if it became 'online'
      if (data.status === 'online') {
        fetchAccounts();
      }
    };

    const handleQr = (data: { id: string, qr: string }) => {
      console.log('QR received for:', data.id);
      setQrCodeData(data);
    };

    socket.on('account:status', handleStatus);
    socket.on('account:qr', handleQr);

    return () => {
      socket.off('account:status', handleStatus);
      socket.off('account:qr', handleQr);
    };
  }, []);

  const fetchAccounts = async () => {
    try {
      const res = await fetch(`/api/accounts`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setAccounts(data);
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
  };

  const handleAddAccount = async () => {
    if (!newAccId.trim()) return;
    setLoading(true);
    setQrCodeData(null);
    try {
      const res = await fetch(`/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: newAccId })
      });
      if (res.ok) {
        // Optimistically add to list
        setAccounts(prev => [...prev, {
          id: newAccId,
          name: newAccId,
          phone: 'Загрузка...',
          status: 'connecting',
          warmup_day: 0,
          warmup_total_days: 14,
          allow_sender: 1,
          allow_warmup: 1,
          is_trusted: 0
        }]);
      } else {
        const err = await res.json();
        alert('Ошибка: ' + err.error);
      }
    } catch (err) {
      console.error('Add account error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Удалить аккаунт ${id}?`)) return;
    try {
      await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
      setAccounts(prev => prev.filter(acc => acc.id !== id));
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleReconnect = async (id: string) => {
    setQrCodeData(null);
    setIsModalOpen(true);
    try {
      await fetch(`/api/accounts/${id}/reconnect`, { method: 'POST' });
    } catch (err) {
      console.error('Reconnect error:', err);
    }
  };

  const handlePermissionChange = async (id: string, field: 'allow_sender' | 'allow_warmup' | 'is_trusted', value: boolean) => {
    setAccounts(prev => prev.map(acc => 
      acc.id === id ? { ...acc, [field]: value ? 1 : 0 } : acc
    ));
    try {
      await fetch(`/api/accounts/${id}/permissions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      });
    } catch (err) {
      console.error('Permission update error:', err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <h1 className="page-title">Аккаунты</h1>
          <div className="text-secondary mt-1">Управление WhatsApp сессиями</div>
        </div>
        <button 
          className="btn btn-primary" 
          onClick={() => {
            setNewAccId('');
            setQrCodeData(null);
            setIsModalOpen(true);
          }}
        >
          + Добавить аккаунт
        </button>
      </div>

      <div className="page-body">
        <div className="grid-4">
          {accounts.map(acc => (
            <div key={acc.id} className="card flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="avatar-circle">{(acc.name || acc.id).charAt(0).toUpperCase()}</div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{acc.name || acc.id}</div>
                    <div className="mono text-xs text-secondary">{acc.phone || 'Нет номера'}</div>
                  </div>
                </div>
              </div>
              
              <div className="flex justify-between items-center mt-2">
                <span className="text-sm font-medium text-secondary">Статус</span>
                {acc.status === 'online' && <span className="badge badge-online">Онлайн</span>}
                {acc.status === 'offline' && <span className="badge badge-new">Офлайн</span>}
                {acc.status === 'connecting' && <span className="badge badge-replied">Подключение...</span>}
                {acc.status === 'banned' && <span className="badge" style={{ backgroundColor: 'var(--color-error-bg)', color: 'var(--color-error)' }}>Забанен</span>}
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1 font-medium text-secondary">
                  <span>Прогрев</span>
                  <span>День {acc.warmup_day || 0} из {acc.warmup_total_days || 14}</span>
                </div>
                <div style={{ height: '6px', width: '100%', backgroundColor: '#F3F4F6', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ 
                    width: `${((acc.warmup_day || 0) / (acc.warmup_total_days || 14)) * 100}%`, 
                    height: '100%', 
                    backgroundColor: acc.warmup_day === acc.warmup_total_days ? 'var(--color-success)' : 'var(--color-primary)', 
                    borderRadius: '4px' 
                  }} />
                </div>
              </div>

              {/* Toggles */}
              <div className="flex flex-col gap-2 mt-1 py-2" style={{ borderTop: '1px solid var(--color-border-weak)', borderBottom: '1px solid var(--color-border-weak)' }}>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium text-secondary">Участвует в рассылке</span>
                  <input 
                    type="checkbox" 
                    style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }}
                    checked={acc.allow_sender === 1 || acc.allow_sender === true}
                    onChange={(e) => handlePermissionChange(acc.id, 'allow_sender', e.target.checked)}
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium text-secondary">Участвует в прогреве</span>
                  <input 
                    type="checkbox" 
                    style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }}
                    checked={acc.allow_warmup === 1 || acc.allow_warmup === true}
                    onChange={(e) => handlePermissionChange(acc.id, 'allow_warmup', e.target.checked)}
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>Трастовый аккаунт</span>
                  <input 
                    type="checkbox" 
                    style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }}
                    checked={acc.is_trusted === 1 || acc.is_trusted === true}
                    onChange={(e) => handlePermissionChange(acc.id, 'is_trusted', e.target.checked)}
                  />
                </label>
              </div>

              <div className="flex gap-2 mt-2">
                <button className="btn btn-secondary w-full" onClick={() => handleReconnect(acc.id)}>QR-код / Подключить</button>
                <button className="btn btn-ghost w-full" onClick={() => handleDelete(acc.id)}>Удалить</button>
              </div>
            </div>
          ))}
          {accounts.length === 0 && (
             <div className="text-secondary text-sm">Аккаунты не найдены. Добавьте первый аккаунт.</div>
          )}
        </div>
      </div>

      {/* Basic Modal for Adding Account / Showing QR */}
      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="card" style={{ width: '400px', backgroundColor: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="flex justify-between items-center">
              <h2 className="card-title" style={{ margin: 0 }}>Добавление аккаунта</h2>
              <button className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>✕</button>
            </div>

            {!qrCodeData ? (
              <>
                <label className="form-label">ID аккаунта (например: acc_1)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newAccId} 
                  onChange={e => setNewAccId(e.target.value)} 
                  placeholder="acc_1"
                />
                <button className="btn btn-primary w-full" onClick={handleAddAccount} disabled={loading}>
                  {loading ? 'Запуск...' : 'Создать и получить QR'}
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="text-sm text-center">Отсканируйте этот QR-код в приложении WhatsApp на вашем телефоне (Связанные устройства)</div>
                <div style={{ padding: '16px', backgroundColor: 'white', borderRadius: '12px' }}>
                  <img src={qrCodeData.qr} alt="WhatsApp QR Code" style={{ width: '250px', height: '250px' }} />
                </div>
                <div className="text-xs text-secondary mono">ID: {qrCodeData.id}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
