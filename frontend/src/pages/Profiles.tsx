import React, { useState, useEffect } from 'react';

interface Profile {
  id: string;
  name: string;
  user_agent: string;
  viewport_width: number;
  viewport_height: number;
  locale: string;
  timezone: string;
  platform: string;
  hardware_concurrency: number;
  device_memory: number;
  webgl_vendor: string;
  webgl_renderer: string;
  canvas_noise: number;
  session_path: string | null;
  proxy: string | null;
  created_at: string;
}

export function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingProxy, setEditingProxy] = useState<string | null>(null);
  const [proxyValue, setProxyValue] = useState('');

  const loadProfiles = async () => {
    try {
      const res = await fetch(`/api/profiles`);
      const data = await res.json();
      setProfiles(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load profiles', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProfiles(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch(`/api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName || undefined }),
      });
      const profile = await res.json();
      setProfiles(prev => [profile, ...prev]);
      setNewName('');
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить профиль?')) return;
    try {
      await fetch(`/api/profiles/` + id, { method: 'DELETE' });
      setProfiles(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveProxy = async (id: string) => {
    try {
      await fetch(`/api/profiles/` + id + '/proxy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxy: proxyValue || null }),
      });
      setProfiles(prev => prev.map(p => p.id === id ? { ...p, proxy: proxyValue || null } : p));
      setEditingProxy(null);
      setProxyValue('');
    } catch (err) {
      console.error(err);
    }
  };

  const hasSession = (p: Profile) => p.session_path !== null;

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <h1 className="page-title">Браузерные Профили</h1>
          <div className="text-secondary mt-1">Антидетект-слепки для OLX. Каждый профиль — уникальный браузер.</div>
        </div>
        <div className="flex gap-3 items-center">
          <input
            type="text"
            className="form-input"
            placeholder="Имя профиля (необяз.)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            style={{ width: '220px' }}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? 'Создание...' : '+ Новый профиль'}
          </button>
        </div>
      </div>

      <div className="page-body">
        {loading && (
          <div className="card text-center text-secondary py-12">Загрузка профилей...</div>
        )}

        {!loading && profiles.length === 0 && (
          <div className="card text-center py-12">
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🧬</div>
            <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Нет профилей</div>
            <div className="text-secondary">Создайте первый профиль — система сгенерирует уникальный цифровой отпечаток.</div>
          </div>
        )}

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '16px' }}>
          {profiles.map(profile => (
            <div key={profile.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--color-text-primary)' }}>{profile.name}</div>
                  <div className="mono text-xs text-secondary" style={{ marginTop: '2px' }}>{profile.id.slice(0, 8)}...</div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span className={'badge ' + (hasSession(profile) ? 'badge-success' : 'badge-neutral')}>
                    {hasSession(profile) ? '✓ Сессия есть' : 'Нет сессии'}
                  </span>
                </div>
              </div>

              {/* Fingerprint details */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: '12px' }}>
                <div><span className="text-secondary">ОС:</span> <strong>{profile.platform}</strong></div>
                <div><span className="text-secondary">Процессор:</span> <strong>{profile.hardware_concurrency} ядер</strong></div>
                <div><span className="text-secondary">Память:</span> <strong>{profile.device_memory} ГБ</strong></div>
                <div><span className="text-secondary">Экран:</span> <strong>{profile.viewport_width}×{profile.viewport_height}</strong></div>
                <div><span className="text-secondary">Локаль:</span> <strong>{profile.locale}</strong></div>
                <div><span className="text-secondary">Таймзона:</span> <strong>{profile.timezone}</strong></div>
                <div style={{ gridColumn: '1/-1' }}>
                  <span className="text-secondary">Графика:</span> <strong style={{ wordBreak: 'break-word' }}>{profile.webgl_renderer.replace('ANGLE (', '').replace(')', '')}</strong>
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <span className="text-secondary">UA:</span> <span className="mono" style={{ fontSize: '10px', wordBreak: 'break-all', color: 'var(--color-text-tertiary)' }}>{profile.user_agent.replace('Mozilla/5.0 ', '')}</span>
                </div>
              </div>

              {/* Proxy */}
              <div style={{ borderTop: '1px solid var(--color-border-weak)', paddingTop: '8px' }}>
                {editingProxy === profile.id ? (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      className="form-input"
                      style={{ flex: 1, fontSize: '12px', height: '32px' }}
                      placeholder="socks5://user:pass@host:port"
                      value={proxyValue}
                      onChange={e => setProxyValue(e.target.value)}
                      autoFocus
                    />
                    <button className="btn btn-primary" style={{ padding: '0 12px', height: '32px', fontSize: '12px' }} onClick={() => handleSaveProxy(profile.id)}>Сохранить</button>
                    <button className="btn btn-ghost" style={{ padding: '0 8px', height: '32px', fontSize: '12px' }} onClick={() => { setEditingProxy(null); setProxyValue(''); }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '12px' }}>
                      <span className="text-secondary">Прокси: </span>
                      {profile.proxy
                        ? <span className="mono" style={{ color: 'var(--color-success)' }}>{profile.proxy}</span>
                        : <span style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>не задан</span>
                      }
                    </div>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '2px 10px', fontSize: '11px', height: '28px' }}
                      onClick={() => { setEditingProxy(profile.id); setProxyValue(profile.proxy || ''); }}
                    >
                      {profile.proxy ? 'Изменить' : '+ Прокси'}
                    </button>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-ghost w-full"
                  style={{ fontSize: '12px', color: 'var(--color-error)' }}
                  onClick={() => handleDelete(profile.id)}
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
