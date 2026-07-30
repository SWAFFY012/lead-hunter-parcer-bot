import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type MapParserKey = 'google' | 'yandex' | 'twoGis';

const mapParsers = [
  { key: 'google' as const, label: 'Google', path: '/parser/google-maps', endpoint: 'google-maps' },
  { key: 'yandex' as const, label: 'Яндекс', path: '/parser/yandex-maps', endpoint: 'yandex-maps' },
  { key: 'twoGis' as const, label: '2ГИС', path: '/parser/2gis-maps', endpoint: '2gis-maps' },
];

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
  const [running, setRunning] = useState<Record<MapParserKey, boolean>>({
    google: false,
    yandex: false,
    twoGis: false,
  });

  useEffect(() => {
    let active = true;
    const apiBase = `http://${window.location.hostname}:3001/api`;
    const updateStatuses = async () => {
      const statuses = await Promise.all(mapParsers.map(async (parser) => {
        try {
          const response = await fetch(`${apiBase}/${parser.endpoint}/status`);
          const data = await response.json() as { isRunning?: boolean };
          return [parser.key, Boolean(data.isRunning)] as const;
        } catch {
          return [parser.key, false] as const;
        }
      }));
      if (active) setRunning(Object.fromEntries(statuses) as Record<MapParserKey, boolean>);
    };
    void updateStatuses();
    const intervalId = window.setInterval(updateStatuses, 2500);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const parserState = (key: MapParserKey) => (
    <span className={`parser-source-state ${running[key] ? 'active' : ''}`}>
      <i />{running[key] ? 'Работает' : 'Свободен'}
    </span>
  );

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
          <h2>Три карты работают одновременно.</h2>
          <p>Откройте Google, Яндекс и 2ГИС в отдельных вкладках — задачи выполняются независимо и не смешивают результаты.</p>
        </div>

        <section className="parser-parallel-panel">
          <div>
            <span className="parser-hub-kicker">ПАРАЛЛЕЛЬНЫЙ РЕЖИМ</span>
            <strong>Ускорить поиск в 3 раза</strong>
            <p>Запустите три источника с одинаковым или разными запросами. У каждого парсера свой журнал, прогресс и кнопка остановки.</p>
          </div>
          <div className="parser-parallel-links" aria-label="Открыть парсеры в новых вкладках">
            {mapParsers.map((parser) => (
              <a key={parser.key} href={parser.path} target="_blank" rel="noreferrer">
                {parser.label} ↗
              </a>
            ))}
          </div>
        </section>

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
            {parserState('google')}
            <span className="parser-source-icon"><MapsIcon /></span>
            <span className="parser-source-copy">
              <strong>Google Карты</strong>
              <span>Сбор компаний, телефонов, сайтов и рейтингов по поисковой выдаче Google Карт.</span>
            </span>
            <span className="parser-source-link">Открыть Google Карты <b>→</b></span>
          </button>

          <button className="parser-source-card yandex" onClick={() => navigate('/parser/yandex-maps')}>
            <span className="parser-source-number">03</span>
            {parserState('yandex')}
            <span className="parser-source-icon"><MapsIcon /></span>
            <span className="parser-source-copy">
              <strong>Яндекс Карты</strong>
              <span>Сбор компаний, телефонов, сайтов и всех соцсетей, указанных в карточке или на сайте.</span>
            </span>
            <span className="parser-source-link">Открыть Яндекс Карты <b>→</b></span>
          </button>

          <button className="parser-source-card twogis" onClick={() => navigate('/parser/2gis-maps')}>
            <span className="parser-source-number">04</span>
            {parserState('twoGis')}
            <span className="parser-source-icon"><MapsIcon /></span>
            <span className="parser-source-copy">
              <strong>2ГИС</strong>
              <span>Быстрый сбор компаний, полных телефонов, сайтов, Telegram, WhatsApp и Instagram прямо из карточек 2ГИС.</span>
            </span>
            <span className="parser-source-link">Открыть 2ГИС <b>→</b></span>
          </button>
        </div>
      </div>
    </div>
  );
}
