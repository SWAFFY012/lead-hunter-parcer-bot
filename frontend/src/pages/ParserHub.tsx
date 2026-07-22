import React from 'react';
import { useNavigate } from 'react-router-dom';

export function ParserHub() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <h1 className="page-title">Авто-Парсинг</h1>
          <div className="text-secondary mt-1">Выберите платформу для сбора лидов</div>
        </div>
      </div>

      <div className="page-body">
        <div className="grid-3 gap-6" style={{ marginTop: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          
          <div 
            className="card hoverable" 
            style={{ padding: '32px', cursor: 'pointer', border: '2px solid transparent', transition: 'all 0.2s' }}
            onClick={() => navigate('/parser/olx')}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛍️</div>
            <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>OLX (Украина)</h2>
            <p className="text-secondary" style={{ lineHeight: 1.5 }}>
              Сбор лидов по ссылкам на рубрики или результаты поиска. 
              Требуется импорт файлов cookie для обхода защиты DataDome.
            </p>
            <div className="mt-6 flex items-center text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
              Перейти к OLX →
            </div>
          </div>

          <div 
            className="card hoverable" 
            style={{ padding: '32px', cursor: 'pointer', border: '2px solid transparent', transition: 'all 0.2s' }}
            onClick={() => navigate('/parser/instagram')}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#e1306c'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📸</div>
            <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>Instagram</h2>
            <p className="text-secondary" style={{ lineHeight: 1.5 }}>
              Сбор целевой аудитории по хэштегам (например, #таргетолог). 
              Включает сбор описаний профилей (Bio) для генерации идеальных персонализированных сообщений.
            </p>
            <div className="mt-6 flex items-center text-sm font-semibold" style={{ color: '#e1306c' }}>
              Перейти к Instagram →
            </div>
          </div>

          <div 
            className="card hoverable" 
            style={{ padding: '32px', cursor: 'pointer', border: '2px solid transparent', transition: 'all 0.2s' }}
            onClick={() => navigate('/parser/google-maps')}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#4285F4'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🗺️</div>
            <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>Google Maps</h2>
            <p className="text-secondary" style={{ lineHeight: 1.5 }}>
              Сбор компаний по ссылке на поиск в Google Картах. 
              Автоматически прокручивает список и извлекает номера телефонов, сайты и рейтинги из скрытых полей или напрямую с карточки.
            </p>
            <div className="mt-6 flex items-center text-sm font-semibold" style={{ color: '#4285F4' }}>
              Перейти к Google Maps →
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
