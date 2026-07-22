import React from 'react';
import { useNavigate } from 'react-router-dom';

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.6 3.2 18.4 19c-.24 1.12-.87 1.39-1.77.87l-4.88-3.6-2.35 2.27c-.26.26-.48.48-.98.48l.35-4.97 9.05-8.18c.4-.35-.08-.55-.61-.2L6.02 12.72 1.2 11.21C.15 10.88.13 10.16 1.42 9.66L20.25 2.4c.87-.32 1.64.2 1.35.8Z" />
    </svg>
  );
}

function MapsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z" />
    </svg>
  );
}

export function ParserHub() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full">
      <div className="page-header">
        <div>
          <h1>Автопарсинг</h1>
          <div className="text-secondary mt-1">Выберите источник для сбора лидов</div>
        </div>
      </div>

      <div className="page-body parser-hub-body">
        <div className="parser-hub-intro">
          <span className="parser-hub-kicker">ИСТОЧНИКИ ДАННЫХ</span>
          <h2>Два канала. Один поток лидов.</h2>
          <p>Ищите целевые сообщества в Telegram или собирайте компании из Google Карт.</p>
        </div>

        <div className="parser-source-grid">
          <button className="parser-source-card telegram" onClick={() => navigate('/parser/telegram')}>
            <span className="parser-source-number">01</span>
            <span className="parser-source-icon"><TelegramIcon /></span>
            <span className="parser-source-copy">
              <strong>Telegram</strong>
              <span>Поиск каналов и постов-объявлений. Извлечение телефонов, сайтов и Telegram-контактов из текста.</span>
            </span>
            <span className="parser-source-link">Открыть Telegram <b>→</b></span>
          </button>

          <button className="parser-source-card maps" onClick={() => navigate('/parser/google-maps')}>
            <span className="parser-source-number">02</span>
            <span className="parser-source-icon"><MapsIcon /></span>
            <span className="parser-source-copy">
              <strong>Google Карты</strong>
              <span>Сбор компаний, телефонов, сайтов и рейтингов по поисковой выдаче Google Карт.</span>
            </span>
            <span className="parser-source-link">Открыть Google Карты <b>→</b></span>
          </button>

          <button className="parser-source-card yandex" onClick={() => navigate('/parser/yandex-maps')}>
            <span className="parser-source-number">03</span>
            <span className="parser-source-icon"><MapsIcon /></span>
            <span className="parser-source-copy">
              <strong>Яндекс Карты</strong>
              <span>Сбор компаний, телефонов, сайтов и всех соцсетей, указанных в карточке или на сайте.</span>
            </span>
            <span className="parser-source-link">Открыть Яндекс Карты <b>→</b></span>
          </button>
        </div>
      </div>
    </div>
  );
}
