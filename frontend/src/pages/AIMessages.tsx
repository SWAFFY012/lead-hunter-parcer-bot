import React, { useState, useEffect } from 'react';

interface Prompt {
  id: number;
  name: string;
  system_prompt: string;
  message_template: string;
  model_name: string;
}

export function AIMessages() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [messageTemplate, setMessageTemplate] = useState('');

  const fetchPrompts = async () => {
    try {
      const res = await fetch(`/api/ai/prompts`);
      const data = await res.json();
      setPrompts(data);
      if (data.length > 0 && !selectedPrompt) {
        selectPrompt(data[0]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, []);

  const selectPrompt = (p: Prompt) => {
    setSelectedPrompt(p);
    setName(p.name);
    setSystemPrompt(p.system_prompt || '');
    setMessageTemplate(p.message_template || '');
  };

  const handleNew = () => {
    setSelectedPrompt(null);
    setName('');
    setSystemPrompt('Ты опытный менеджер по продажам...');
    setMessageTemplate('Здравствуйте, {{name}}! Вижу ваше объявление про {{title}}...');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name,
        system_prompt: systemPrompt,
        message_template: messageTemplate,
        model_name: 'llama3'
      };

      const url = selectedPrompt 
        ? `/api/ai/prompts/${selectedPrompt.id}`
        : `/api/ai/prompts`;
      const method = selectedPrompt ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const saved = await res.json();
        await fetchPrompts();
        selectPrompt(saved);
        alert('Промпт успешно сохранен!');
      } else {
        alert('Ошибка при сохранении промпта');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPrompt) return;
    if (!confirm('Удалить этот промпт?')) return;
    
    try {
      await fetch(`/api/ai/prompts/${selectedPrompt.id}`, { method: 'DELETE' });
      setSelectedPrompt(null);
      await fetchPrompts();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <h1 className="page-title">Промпты и Шаблоны</h1>
          <div className="text-secondary" style={{ marginTop: '4px' }}>Управление системными правилами и шаблонами сообщений для AI</div>
        </div>
        <button className="btn btn-primary" onClick={handleNew}>+ Создать промпт</button>
      </div>

      <div className="page-body flex gap-8" style={{ maxWidth: '1200px', margin: '0 auto', width: '100%', alignItems: 'flex-start' }}>
        
        {/* Sidebar List */}
        <div className="card" style={{ width: '300px', padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: '12px' }}>
            Ваши промпты
          </div>
          {loading ? (
            <div className="text-secondary">Загрузка...</div>
          ) : prompts.length === 0 ? (
            <div className="text-secondary text-sm">Нет сохраненных промптов</div>
          ) : (
            <div className="flex flex-col gap-2">
              {prompts.map(p => (
                <button
                  key={p.id}
                  onClick={() => selectPrompt(p)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    textAlign: 'left',
                    border: '1px solid',
                    borderColor: selectedPrompt?.id === p.id ? 'var(--primary)' : 'var(--color-border-weak)',
                    backgroundColor: selectedPrompt?.id === p.id ? 'var(--primary-light)' : 'transparent',
                    color: selectedPrompt?.id === p.id ? 'var(--primary)' : 'var(--color-text)',
                    fontWeight: selectedPrompt?.id === p.id ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="card flex-1">
          <div className="flex justify-between items-center mb-6">
            <span className="card-title m-0">Редактор</span>
            {selectedPrompt && (
              <button className="btn btn-ghost text-red-500" onClick={handleDelete} style={{ color: 'var(--error)' }}>
                Удалить промпт
              </button>
            )}
          </div>
          
          <div style={{ marginTop: '1rem' }}>
            <label className="form-label mb-2">Название промпта (для вас)</label>
            <input 
              type="text"
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Например: Холодная рассылка (Строители)"
            />
          </div>

          <div style={{ marginTop: '1.5rem', backgroundColor: '#F0FDF4', padding: '16px', borderRadius: '12px', border: '1px solid #BBF7D0' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#166534', marginBottom: '8px' }}>💡 Как работают эти два поля?</div>
            <ul style={{ fontSize: '13px', color: '#15803D', paddingLeft: '16px', margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <li><strong>Системный Промпт:</strong> Это общие правила (Роль). Например: <i>«Ты лучший менеджер по продажам. Пиши кратко (до 300 символов), используй структуру: Приветствие → Суть → Вопрос».</i></li>
              <li><strong>Пользовательский Промпт:</strong> Это само задание. Сюда можно подставить <code>{`{{name}}`}</code>. Данные объявления (Текст, Заголовок, Город) <strong>уже передаются нейросети автоматически</strong>, вам не обязательно их дублировать!</li>
              <li><strong>Секрет:</strong> Вы можете попросить нейросеть выдать ответ в формате Спинтакс, например: <i>«Начни сообщение со слов {`{Здравствуйте|Добрый день}`}»</i>, и система сама рандомизирует результат перед отправкой!</li>
            </ul>
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <div className="flex justify-between items-end mb-2">
              <label className="form-label" style={{ marginBottom: 0 }}>Системный Промпт (Правила и Роль ИИ)</label>
            </div>
            <textarea 
              className="form-textarea"
              style={{ 
                backgroundColor: '#F9FAFB', 
                minHeight: '120px', 
                fontSize: '14px',
                padding: '16px',
                borderRadius: '12px',
                resize: 'vertical'
              }}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Например: Ты опытный менеджер. Сделай текст продающим, не более 300 символов. Обязательно предложи сотрудничество."
            />
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <div className="flex justify-between items-end mb-2">
              <label className="form-label" style={{ marginBottom: 0 }}>Пользовательский Промпт (Задание для ИИ)</label>
              <div className="flex gap-2 flex-wrap">
                <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => setMessageTemplate(messageTemplate + ' {{name}}')}>+ Имя</button>
                <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => setMessageTemplate(messageTemplate + ' {{phone}}')}>+ IG Ник / Телефон</button>
                <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => setMessageTemplate(messageTemplate + ' {{title}}')}>+ Заголовок</button>
                <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => setMessageTemplate(messageTemplate + ' {{text}}')}>+ Описание</button>
                <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => setMessageTemplate(messageTemplate + ' {{city}}')}>+ Город</button>
              </div>
            </div>
            <textarea 
              className="form-textarea"
              style={{ 
                backgroundColor: '#F9FAFB', 
                minHeight: '160px', 
                fontSize: '15px',
                padding: '16px',
                borderRadius: '12px',
                resize: 'vertical'
              }}
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              placeholder="Например: Напиши сообщение для клиента по имени {{name}}. Опирайся на его объявление."
            />
          </div>

          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button 
              className="btn btn-primary" 
              style={{ padding: '12px 32px' }}
              onClick={handleSave}
              disabled={saving || !name.trim()}
            >
              {saving ? 'Сохранение...' : 'Сохранить промпт'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
