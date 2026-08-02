import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveXlsx } from '../utils/xlsx';

const API = `/api/telegram`;

type AuthState = 'disconnected' | 'connecting' | 'code_required' | 'password_required' | 'verifying' | 'connected' | 'error';

interface TelegramAccount {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
}

interface TelegramStatus {
  state: AuthState;
  connected: boolean;
  error: string;
  account: TelegramAccount | null;
}

interface TelegramChat {
  id: string;
  title: string;
  username: string;
  link: string;
  type: 'group' | 'channel';
  participantsCount: number | null;
  verified: boolean;
}

interface TelegramAuthor {
  id: string;
  name: string;
  username: string;
  phone: string;
  bot: boolean;
}

interface TelegramMessage {
  id: number;
  date: string;
  text: string;
  authorId: string;
  authorName: string;
  username: string;
  views: number;
  forwards: number;
}

interface TelegramAdvert {
  messageId: number;
  date: string;
  authorName: string;
  text: string;
  phones: string[];
  websites: string[];
  telegramLinks: string[];
}

interface ParseResult {
  chat: TelegramChat;
  messages: TelegramMessage[];
  authors: TelegramAuthor[];
  adverts: TelegramAdvert[];
}

const emptyStatus: TelegramStatus = {
  state: 'disconnected',
  connected: false,
  error: '',
  account: null,
};

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, options);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || 'Ошибка запроса.');
  return data as T;
}

function csvCell(value: string | number | boolean) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function saveCsv(filename: string, rows: Array<Array<string | number | boolean>>) {
  const content = '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ParserTelegram() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<TelegramStatus>(emptyStatus);
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [query, setQuery] = useState('');
  const [chats, setChats] = useState<TelegramChat[]>([]);
  const [selectedChat, setSelectedChat] = useState<TelegramChat | null>(null);
  const [messageLimit, setMessageLimit] = useState(100);
  const [messageSearch, setMessageSearch] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [activeTab, setActiveTab] = useState<'adverts' | 'messages'>('adverts');
  const [contactFilter, setContactFilter] = useState<'all' | 'phone' | 'telegram'>('all');
  const [websiteFilter, setWebsiteFilter] = useState<'all' | 'with' | 'without'>('all');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<TelegramStatus>('/status')
      .then(setStatus)
      .catch((requestError: Error) => setError(requestError.message));
  }, []);

  const run = async <T,>(name: string, action: () => Promise<T>) => {
    setBusy(name);
    setError('');
    try {
      return await action();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Неизвестная ошибка.');
      return null;
    } finally {
      setBusy('');
    }
  };

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    const next = await run('connect', () => apiRequest<TelegramStatus>('/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiId, apiHash, phone }),
    }));
    if (next) setStatus(next);
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    const next = await run('code', () => apiRequest<TelegramStatus>('/code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    }));
    if (next) { setStatus(next); setCode(''); }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    const next = await run('password', () => apiRequest<TelegramStatus>('/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    }));
    if (next) { setStatus(next); setPassword(''); }
  };

  const disconnect = async () => {
    const next = await run('disconnect', () => apiRequest<TelegramStatus>('/disconnect', { method: 'POST' }));
    if (next) {
      setStatus(next);
      setChats([]);
      setSelectedChat(null);
      setResult(null);
    }
  };

  const searchChats = async (event: FormEvent) => {
    event.preventDefault();
    const data = await run('search', () => apiRequest<{ chats: TelegramChat[] }>(`/search?q=${encodeURIComponent(query)}&limit=30&channelsOnly=true`));
    if (data) {
      setChats(data.chats);
      setSelectedChat(null);
      setResult(null);
    }
  };

  const parseChat = async () => {
    if (!selectedChat) return;
    const data = await run('parse', () => apiRequest<ParseResult>('/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: selectedChat.id, limit: messageLimit, search: messageSearch }),
    }));
    if (data) setResult(data);
  };

  const accountName = status.account
    ? [status.account.firstName, status.account.lastName].filter(Boolean).join(' ') || status.account.username || status.account.phone
    : '';

  const filteredAdverts = useMemo(() => {
    if (!result) return [];
    return result.adverts.filter((advert) => {
      const contactMatches = contactFilter === 'all'
        || (contactFilter === 'phone' ? advert.phones.length > 0 : advert.telegramLinks.length > 0);
      const websiteMatches = websiteFilter === 'all'
        || (websiteFilter === 'with' ? advert.websites.length > 0 : advert.websites.length === 0);
      return contactMatches && websiteMatches;
    });
  }, [contactFilter, result, websiteFilter]);

  return (
    <div className="telegram-page">
      <header className="telegram-header">
        <button className="telegram-back" onClick={() => navigate('/parser')} aria-label="Назад">←</button>
        <div>
          <span className="telegram-kicker">ПАРСЕР / TELEGRAM</span>
          <h1>Поиск каналов и объявлений</h1>
          <p>Бот читает доступные посты и достаёт указанные в тексте телефоны, сайты и Telegram-контакты.</p>
        </div>
        <span className={`telegram-status ${status.connected ? 'online' : ''}`}>
          <i /> {status.connected ? 'Подключён' : 'Не подключён'}
        </span>
      </header>

      <main className="telegram-body">
        {(error || status.error) && <div className="telegram-alert">{error || status.error}</div>}

        {!status.connected && (
          <section className="telegram-auth-grid">
            <div className="telegram-step-rail" aria-hidden="true">
              <span className="active">01</span><i /><span className={status.state === 'code_required' ? 'active' : ''}>02</span><i /><span className={status.state === 'password_required' ? 'active' : ''}>03</span>
            </div>
            <div className="telegram-panel auth-panel">
              <span className="panel-label">ПОДКЛЮЧЕНИЕ АККАУНТА</span>
              {status.state === 'code_required' ? (
                <form onSubmit={submitCode}>
                  <h2>Введите код из Telegram</h2>
                  <p className="panel-help">Код пришёл в официальный чат Telegram на вашем устройстве.</p>
                  <label>Код подтверждения</label>
                  <input className="form-input telegram-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="12345" autoFocus />
                  <button className="btn btn-primary" disabled={busy === 'code'}>{busy === 'code' ? 'Проверяем…' : 'Подтвердить код'}</button>
                </form>
              ) : status.state === 'password_required' ? (
                <form onSubmit={submitPassword}>
                  <h2>Нужен пароль 2FA</h2>
                  <p className="panel-help">Введите облачный пароль двухэтапной аутентификации Telegram.</p>
                  <label>Пароль</label>
                  <input type="password" className="form-input" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
                  <button className="btn btn-primary" disabled={busy === 'password'}>{busy === 'password' ? 'Проверяем…' : 'Войти'}</button>
                </form>
              ) : (
                <form onSubmit={connect}>
                  <h2>Подключение через публичный Telegram API</h2>
                  <p className="panel-help">По умолчанию используются публичные параметры Telegram Desktop. Укажите свои API ID и API Hash только если хотите заменить их данными с <a href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org</a>.</p>
                  <div className="telegram-form-row">
                    <div><label>Свой API ID <small>(необязательно)</small></label><input type="number" className="form-input" value={apiId} onChange={(event) => setApiId(event.target.value)} placeholder="Использовать публичный" /></div>
                    <div><label>Свой API Hash <small>(необязательно)</small></label><input type="password" className="form-input" value={apiHash} onChange={(event) => setApiHash(event.target.value)} placeholder="Использовать публичный" /></div>
                  </div>
                  <label>Номер телефона</label>
                  <input className="form-input" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+79991234567" />
                  <button className="btn btn-primary" disabled={busy === 'connect'}>{busy === 'connect' ? 'Подключаем…' : 'Получить код'}</button>
                </form>
              )}
            </div>
            <aside className="telegram-note">
              <b>Как это работает</b>
              <p>Telegram не разрешает боту искать любые чаты. Поэтому вход выполняется как обычный пользователь через официальный MTProto API.</p>
              <small>Файл сессии хранится только на этом компьютере.</small>
            </aside>
          </section>
        )}

        {status.connected && (
          <>
            <section className="telegram-account-bar">
              <div className="telegram-avatar">{accountName.slice(0, 1).toUpperCase()}</div>
              <div><span>АКТИВНЫЙ АККАУНТ</span><strong>{accountName}</strong><small>{status.account?.username ? `@${status.account.username}` : status.account?.phone}</small></div>
              <button className="btn btn-secondary" onClick={disconnect} disabled={busy === 'disconnect'}>Отключить</button>
            </section>

            <section className="telegram-workspace">
              <div className="telegram-panel search-panel">
                <span className="panel-label">01 / НАЙТИ КАНАЛ</span>
                <h2>Поиск публичных каналов</h2>
                <form className="telegram-search" onSubmit={searchChats}>
                  <input className="form-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например: маркетинг Москва" />
                  <button className="btn btn-primary" disabled={busy === 'search'}>{busy === 'search' ? 'Ищем…' : 'Найти'}</button>
                </form>
                <div className="telegram-chat-list">
                  {chats.length === 0 && <div className="telegram-empty">Введите ключевое слово или название канала</div>}
                  {chats.map((chat) => (
                    <button key={chat.id} className={selectedChat?.id === chat.id ? 'selected' : ''} onClick={() => { setSelectedChat(chat); setResult(null); }}>
                      <span className="chat-mark">{chat.type === 'channel' ? 'К' : 'Г'}</span>
                      <span><strong>{chat.title}</strong><small>{chat.username ? `@${chat.username}` : chat.type === 'channel' ? 'Канал' : 'Группа'}</small></span>
                      {chat.participantsCount && <em>{chat.participantsCount.toLocaleString('ru-RU')}</em>}
                    </button>
                  ))}
                </div>
                {chats.length > 0 && (
                  <div className="maps-action-buttons">
                    <button className="btn btn-secondary" onClick={() => saveCsv(
                      `telegram-channels-${query.trim() || 'search'}.csv`,
                      [['Название', 'Юзернейм', 'Ссылка', 'Участников'], ...chats.map((chat) => [chat.title, chat.username ? `@${chat.username}` : '', chat.link, chat.participantsCount || 'Н/Д'])]
                    )}>Скачать каналы CSV</button>
                    <button className="btn btn-secondary" onClick={() => saveXlsx(
                      `telegram-channels-${query.trim() || 'search'}.xlsx`,
                      [['Название', 'Юзернейм', 'Ссылка', 'Участников'], ...chats.map((chat) => [chat.title, chat.username ? `@${chat.username}` : '', chat.link, chat.participantsCount || 'Н/Д'])]
                    )}>Скачать каналы XLSX</button>
                  </div>
                )}
              </div>

              <div className="telegram-panel parse-panel">
                <span className="panel-label">02 / СОБРАТЬ ДАННЫЕ</span>
                <h2>{selectedChat ? selectedChat.title : 'Выберите чат слева'}</h2>
                <label>Количество последних сообщений</label>
                <input type="number" min="1" max="500" className="form-input" value={messageLimit} onChange={(event) => setMessageLimit(Number(event.target.value))} disabled={!selectedChat} />
                <label>Фильтр по тексту <small>(необязательно)</small></label>
                <input className="form-input" value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} placeholder="Например: ищу подрядчика" disabled={!selectedChat} />
                <button className="btn btn-primary parse-button" onClick={parseChat} disabled={!selectedChat || busy === 'parse'}>{busy === 'parse' ? 'Собираем…' : 'Запустить парсинг'}</button>
                <p className="parse-limit">Лимит одного запуска: 500 сообщений</p>
              </div>
            </section>
          </>
        )}

        {result && (
          <section className="telegram-results">
            <div className="results-heading">
              <div><span className="panel-label">03 / РЕЗУЛЬТАТ</span><h2>{result.chat.title}</h2></div>
              <div className="result-metrics"><span><b>{result.adverts.length}</b> с контактами</span><span><b>{result.messages.length}</b> проверено</span></div>
            </div>
            <div className="results-toolbar telegram-contact-toolbar">
              <div><button className={activeTab === 'adverts' ? 'active' : ''} onClick={() => setActiveTab('adverts')}>Объявления с контактами</button><button className={activeTab === 'messages' ? 'active' : ''} onClick={() => setActiveTab('messages')}>Все сообщения</button></div>
              {activeTab === 'adverts' ? <div className="telegram-result-filters">
                <select value={contactFilter} onChange={(event) => setContactFilter(event.target.value as 'all' | 'phone' | 'telegram')}>
                  <option value="all">Все контакты</option><option value="phone">Есть телефон</option><option value="telegram">Есть Telegram</option>
                </select>
                <select value={websiteFilter} onChange={(event) => setWebsiteFilter(event.target.value as 'all' | 'with' | 'without')}>
                  <option value="all">Все сайты</option><option value="with">Есть сайт</option><option value="without">Нет сайта</option>
                </select>
              </div> : null}
              <div className="maps-action-buttons">
                <button className="btn btn-secondary" onClick={() => activeTab === 'adverts'
                  ? saveCsv('telegram-adverts.csv', [['Дата', 'Автор', 'Телефоны', 'Telegram', 'Сайты', 'Текст объявления'], ...filteredAdverts.map((advert) => [advert.date, advert.authorName, advert.phones.join(', '), advert.telegramLinks.join(', '), advert.websites.join(', '), advert.text])])
                  : saveCsv('telegram-messages.csv', [['Дата', 'Автор', 'Username', 'Текст', 'Просмотры', 'Пересылки'], ...result.messages.map((message) => [message.date, message.authorName, message.username, message.text, message.views, message.forwards])])}>Скачать CSV</button>
                <button className="btn btn-secondary" onClick={() => activeTab === 'adverts'
                  ? saveXlsx('telegram-adverts.xlsx', [['Дата', 'Автор', 'Телефоны', 'Telegram', 'Сайты', 'Текст объявления'], ...filteredAdverts.map((advert) => [advert.date, advert.authorName, advert.phones.join(', '), advert.telegramLinks.join(', '), advert.websites.join(', '), advert.text])])
                  : saveXlsx('telegram-messages.xlsx', [['Дата', 'Автор', 'Username', 'Текст', 'Просмотры', 'Пересылки'], ...result.messages.map((message) => [message.date, message.authorName, message.username, message.text, message.views, message.forwards])])}>Скачать XLSX</button>
              </div>
            </div>
            <div className="telegram-table-wrap">
              {activeTab === 'adverts' ? (
                <table><thead><tr><th>Дата / автор</th><th>Телефон</th><th>Telegram</th><th>Сайт</th><th>Объявление</th></tr></thead><tbody>{filteredAdverts.map((advert) => <tr key={advert.messageId}><td>{advert.date ? new Date(advert.date).toLocaleDateString('ru-RU') : '—'}<small className="maps-category">{advert.authorName}</small></td><td>{advert.phones.join(', ') || '—'}</td><td>{advert.telegramLinks.length ? advert.telegramLinks.map((link) => <a key={link} href={link} target="_blank" rel="noreferrer">{link.replace('https://t.me/', '@')}</a>) : '—'}</td><td>{advert.websites.length ? advert.websites.map((link) => <a key={link} href={link} target="_blank" rel="noreferrer">Открыть сайт</a>) : <span className="maps-missing">Нет сайта</span>}</td><td className="message-cell">{advert.text}</td></tr>)}</tbody></table>
              ) : (
                <table><thead><tr><th>Дата</th><th>Автор</th><th>Сообщение</th><th>Просмотры</th></tr></thead><tbody>{result.messages.map((message) => <tr key={message.id}><td>{message.date ? new Date(message.date).toLocaleString('ru-RU') : '—'}</td><td>{message.authorName}</td><td className="message-cell">{message.text || '—'}</td><td>{message.views || '—'}</td></tr>)}</tbody></table>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
