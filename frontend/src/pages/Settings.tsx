import React, { useState, useEffect } from 'react';

export function Settings() {
  // Block 1: Security
  const [safeMode, setSafeMode] = useState(true);
  const [uniqueMedia, setUniqueMedia] = useState(true);
  const [imitateTyping, setImitateTyping] = useState(true);

  // Block 2: Limits
  const [delayMin, setDelayMin] = useState(15);
  const [delayMax, setDelayMax] = useState(45);
  const [dailyLimitNew, setDailyLimitNew] = useState(15);
  const [dailyLimitWarm, setDailyLimitWarm] = useState(75);

  // Block 3: AI Integration
  const [ollamaUrl, setOllamaUrl] = useState('http://127.0.0.1:11434');
  const [aiProvider, setAiProvider] = useState('ollama');
  const [geminiKey, setGeminiKey] = useState('');
  
  // Block 4: Notifications
  const [reportPhone, setReportPhone] = useState('');
  const [reportFrequency, setReportFrequency] = useState('60');

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`http://${window.location.hostname}:3001/api/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.safe_mode !== undefined) setSafeMode(data.safe_mode === 'true');
        if (data.unique_media !== undefined) setUniqueMedia(data.unique_media === 'true');
        if (data.imitate_typing !== undefined) setImitateTyping(data.imitate_typing === 'true');
        if (data.delay_min !== undefined) setDelayMin(Number(data.delay_min));
        if (data.delay_max !== undefined) setDelayMax(Number(data.delay_max));
        if (data.daily_limit_new !== undefined) setDailyLimitNew(Number(data.daily_limit_new));
        if (data.daily_limit_warm !== undefined) setDailyLimitWarm(Number(data.daily_limit_warm));
        if (data.ollama_url) setOllamaUrl(data.ollama_url);
        if (data.ai_provider) setAiProvider(data.ai_provider);
        if (data.gemini_api_key) setGeminiKey(data.gemini_api_key);
        if (data.report_phone) setReportPhone(data.report_phone);
        if (data.report_frequency) setReportFrequency(data.report_frequency);
      })
      .catch(console.error);
  }, []);

  const saveSettings = async (section: string) => {
    setSaving(true);
    const payload: Record<string, any> = {};
    
    if (section === 'security') {
      payload.safe_mode = safeMode.toString();
      payload.unique_media = uniqueMedia.toString();
      payload.imitate_typing = imitateTyping.toString();
    } else if (section === 'limits') {
      payload.delay_min = delayMin.toString();
      payload.delay_max = delayMax.toString();
      payload.daily_limit_new = dailyLimitNew.toString();
      payload.daily_limit_warm = dailyLimitWarm.toString();
    } else if (section === 'ai') {
      payload.ollama_url = ollamaUrl;
      payload.ai_provider = aiProvider;
      payload.gemini_api_key = geminiKey;
    } else if (section === 'notifications') {
      payload.report_phone = reportPhone;
      payload.report_frequency = reportFrequency;
    }

    try {
      await fetch(`http://${window.location.hostname}:3001/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      alert('Настройки сохранены');
    } catch (e) {
      alert('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <h1 className="page-title">Настройки</h1>
          <div className="text-secondary mt-1">Центр управления антибаном и интеграциями</div>
        </div>
      </div>

      <div className="page-body flex flex-col gap-8" style={{ maxWidth: '860px', margin: '0 auto', width: '100%', paddingBottom: '64px' }}>
        
        {/* Блок 1: Безопасность и Антибан */}
        <div className="card" style={{ padding: '2rem' }}>
          <span className="card-title mb-6">Безопасность и антибан (WhatsApp)</span>
          <div className="flex flex-col gap-6">
            
            <div className="flex justify-between items-center p-4 rounded-xl border border-blue-100" style={{ backgroundColor: 'var(--color-info-bg)' }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--color-info)' }}>Безопасный режим (имитация)</div>
                <div className="text-sm mt-1" style={{ color: '#0369A1' }}>Имитация отправки сообщений без реальной пересылки через WhatsApp. Безопасно для тестов.</div>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={safeMode} onChange={e => setSafeMode(e.target.checked)} />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="flex justify-between items-center">
              <div>
                <div style={{ fontWeight: 500, color: '#111827' }}>Уникализация медиа (защита хеша)</div>
                <div className="text-sm text-secondary mt-1">Автоматическое наложение микро-шумов на изображения для обхода хеш-блэклистов.</div>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={uniqueMedia} onChange={e => setUniqueMedia(e.target.checked)} />
                <span className="toggle-slider"></span>
              </label>
            </div>
            
            <div className="flex justify-between items-center">
              <div>
                <div style={{ fontWeight: 500, color: '#111827' }}>Имитация тайпинга ("Печатает...")</div>
                <div className="text-sm text-secondary mt-1">Задержка перед отправкой сообщения, пропорциональная длине текста.</div>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={imitateTyping} onChange={e => setImitateTyping(e.target.checked)} />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="mt-2 flex justify-end" style={{ borderTop: '1px solid var(--color-border-weak)', paddingTop: '24px' }}>
              <button className="btn btn-secondary" style={{ padding: '10px 24px' }} onClick={() => saveSettings('security')} disabled={saving}>
                {saving ? 'Сохранение...' : 'Применить параметры'}
              </button>
            </div>
          </div>
        </div>

        {/* Блок 2: Лимиты и тайминги */}
        <div className="card" style={{ padding: '2rem' }}>
          <span className="card-title mb-6">Скорость отправки и Лимиты</span>
          <div className="grid-2">
            <div>
              <label className="form-label mb-2">Задержка между сообщениями (сек)</label>
              <div className="flex gap-2 items-center">
                <input type="number" className="form-input" value={delayMin} onChange={e => setDelayMin(Number(e.target.value))} style={{ width: '80px' }} />
                <span className="text-secondary">—</span>
                <input type="number" className="form-input" value={delayMax} onChange={e => setDelayMax(Number(e.target.value))} style={{ width: '80px' }} />
              </div>
              <div className="text-xs text-secondary mt-2">Рандомизация интервала оберегает от бана.</div>
            </div>
            <div>
              <label className="form-label mb-2">Дневной лимит (Новорег)</label>
              <input type="number" className="form-input" value={dailyLimitNew} onChange={e => setDailyLimitNew(Number(e.target.value))} />
              <div className="text-xs text-secondary mt-2">Рекомендуется 10-20 для свежих номеров.</div>
            </div>
            <div>
              <label className="form-label mb-2">Дневной лимит (Прогретый)</label>
              <input type="number" className="form-input" value={dailyLimitWarm} onChange={e => setDailyLimitWarm(Number(e.target.value))} />
              <div className="text-xs text-secondary mt-2">Для трастовых аккаунтов (&gt;14 дней).</div>
            </div>

            <div className="mt-2 flex justify-end" style={{ borderTop: '1px solid var(--color-border-weak)', paddingTop: '24px', gridColumn: 'span 2' }}>
              <button className="btn btn-primary" style={{ padding: '10px 24px' }} onClick={() => saveSettings('limits')} disabled={saving}>
                {saving ? 'Сохранение...' : 'Обновить лимиты'}
              </button>
            </div>
          </div>
        </div>

        {/* Блок 3: Интеграции */}
        <div className="card" style={{ padding: '2rem' }}>
          <span className="card-title mb-6">Интеграции (ИИ и API)</span>
          <div className="flex flex-col gap-6">
            
            <div>
              <label className="form-label mb-2">Провайдер Нейросети</label>
              <select className="form-select" value={aiProvider} onChange={e => setAiProvider(e.target.value)}>
                <option value="ollama">Локальная (Ollama)</option>
                <option value="gemini">Облачная (Gemini 3.5 Flash)</option>
              </select>
            </div>

            {aiProvider === 'ollama' && (
              <div>
                <label className="form-label mb-2">URL сервера Ollama</label>
                <input type="text" className="form-input" value={ollamaUrl} onChange={e => setOllamaUrl(e.target.value)} />
              </div>
            )}

            {aiProvider === 'gemini' && (
              <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                <label className="form-label mb-2 text-purple-900">API Ключ Gemini (Gemini 3.5 Flash)</label>
                <input type="password" className="form-input" value={geminiKey} onChange={e => setGeminiKey(e.target.value)} placeholder="AIzaSy..." />
                <div className="text-xs text-purple-700 mt-2">Использует пул из 5 воркеров. Строго 1 запрос в минуту на воркер (5 лидов/мин) для обхода жестких бесплатных RPM лимитов.</div>
              </div>
            )}
            
            <div className="mt-2 flex justify-end">
              <button className="btn btn-secondary" style={{ padding: '10px 24px' }} onClick={() => saveSettings('ai')} disabled={saving}>
                {saving ? 'Сохранение...' : 'Сохранить интеграции'}
              </button>
            </div>
          </div>
        </div>

        {/* Блок 4: Уведомления */}
        <div className="card" style={{ padding: '2rem' }}>
          <span className="card-title mb-6">Система и Уведомления</span>
          <div className="grid-2">
            <div>
              <label className="form-label mb-2">Номер для отчетов WhatsApp</label>
              <input type="text" className="form-input" value={reportPhone} onChange={e => setReportPhone(e.target.value)} placeholder="+7..." />
            </div>
            <div>
              <label className="form-label mb-2">Частота отчетов (минуты)</label>
              <select className="form-select" value={reportFrequency} onChange={e => setReportFrequency(e.target.value)}>
                <option value="60">Каждые 60 минут</option>
                <option value="end">По завершению рассылки</option>
                <option value="1440">Каждые 24 часа</option>
              </select>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button className="btn btn-secondary" style={{ padding: '10px 24px' }} onClick={() => saveSettings('notifications')} disabled={saving}>
              {saving ? 'Сохранение...' : 'Сохранить настройки уведомлений'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
