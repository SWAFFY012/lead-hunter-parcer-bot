# LeadHunter API Specifications

## 1. REST API Endpoints

### Accounts (`/api/accounts`)
- `GET /` — Получить список всех аккаунтов.
- `POST /` — Создать новый аккаунт (требуется `id`). Возвращает QR-код через сокет.
- `PATCH /:id` — Обновить лимиты аккаунта.
- `POST /:id/reconnect` — Переподключить сессию WhatsApp.
- `DELETE /:id` — Удалить аккаунт и его сессию.

### Parser (`/api/parser`)
- `GET /status` — Статус парсера (запущен/остановлен, активна ли сессия).
- `POST /auth-olx` — Запустить браузер для ручной авторизации на OLX.
- `POST /start` — Запустить парсинг (`url`, `pages`, `campaign_id`).
- `POST /stop` — Остановить парсинг.

### Leads (`/api/leads`)
- `GET /` — Список лидов (поддержка фильтрации по `status`, `search`, `campaign_id`).
- `GET /:id` — Детальная информация о лиде (включая историю сообщений).
- `PATCH /:id` — Обновить статус, теги или заметки лида.
- `DELETE /:id` — Удалить лида.
- `GET /export/csv` — Экспорт лидов в формате CSV.
- `GET /stats/dashboard` — Статистика для главного дашборда.

### Campaigns (`/api/campaigns`)
- `GET /` — Список кампаний.
- `POST /` — Создать кампанию (`name`, `source_url`).
- `GET /:id` — Получить кампанию.
- `GET /:id/stats` — Статистика кампании.

### AI / Ollama (`/api/ai`)
- `GET /status` — Проверка доступности локальной Ollama и списка моделей.
- `GET /prompts` — Список промптов.
- `POST /prompts` — Создать промпт (`system_prompt`, `message_template`).
- `PUT /prompts/:id` — Обновить промпт.
- `DELETE /prompts/:id` — Удалить промпт.
- `POST /generate` — Сгенерировать сообщения для массива лидов (`leadIds`, `promptId`).
- `POST /approve-batch` — Утвердить массив сгенерированных сообщений.

### Sender (`/api/sender`)
- `GET /status` — Текущий статус рассылки (running, stats).
- `POST /start` — Запустить массовую рассылку (`campaign_id`, `account_ids`).
- `POST /pause` — Приостановить рассылку.

### Warmup (`/api/warmup`)
- `GET /status` — Статус прогрева.
- `POST /start` — Запустить алгоритм прогрева между аккаунтами.
- `POST /stop` — Остановить прогрев.
- `PATCH /accounts/:id` — Включить/выключить прогрев для конкретного аккаунта.
- `GET /logs` — История переписок прогрева.

### Settings (`/api/settings`)
- `GET /` — Получить глобальные настройки системы (тайминги, Ollama URL, телефон монитора).
- `PUT /` — Сохранить настройки.

---

## 2. WebSockets Events (Socket.io)

### Исходящие с бэкенда (Frontend слушает)
- **Accounts:**
  - `account:status` — Обновление статуса аккаунта (online, offline, banned).
  - `account:qr` — Передача Base64 QR-кода для сканирования.
- **Parser:**
  - `parser:started`, `parser:done`, `parser:error` — Жизненный цикл парсера.
  - `parser:progress` — Обновление прогресса сбора ссылок/лидов.
  - `parser:log` — Текстовые логи парсера.
  - `parser:auth` — Статус ручной авторизации в браузере.
  - `parser:lead` — Сигнал о новом добавленном лиде.
- **Leads:**
  - `lead:replied` — Входящее сообщение от лида (открывает Toast уведомление).
- **AI:**
  - `ai:generated` — Готовый сгенерированный текст для 1 лида.
  - `ai:batch-done` — Завершение массовой генерации.
- **Sender:**
  - `sender:started`, `sender:paused`, `sender:done`, `sender:error` — Цикл рассылки.
  - `sender:stats` — Обновление счетчиков (отправлено/ошибки/пропущено).
  - `sender:log` — Текстовые логи рассылки.
- **Warmup:**
  - `warmup:status` — Изменение глобального статуса работы.
  - `warmup:progress` — Ежедневный прогресс аккаунта (дни, лимиты).
  - `warmup:log` — Текстовый лог действий.
  - `warmup:message` — Сигнал о том, что аккаунты обменялись сообщениями.
