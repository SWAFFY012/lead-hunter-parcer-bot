# Database Schema Updates (Sync with Strategy)

В связи с внедрением новой стратегии антибана (Auto-Aging, динамические лимиты и проксирование), необходимо обновить структуру SQLite базы данных. Ниже приведены SQL-запросы, которые нужно выполнить для миграции существующих данных без их потери.

## 1. Изменения в таблице `accounts`

Таблица `accounts` уже имеет поле `added_at` (используется для расчета возраста), однако ей не хватает полей для привязки прокси и переопределения уровня (Tier).

**SQL для выполнения:**
```sql
-- Добавление поля для индивидуальных прокси
ALTER TABLE accounts ADD COLUMN proxy_url TEXT;

-- Добавление поля для ручного контроля уровня аккаунта (по умолчанию 0 - автовычисление)
ALTER TABLE accounts ADD COLUMN custom_tier INTEGER DEFAULT 0;
```

## 2. Изменения в таблице `settings`

В таблицу `settings` необходимо добавить ключи для расчета шагов увеличения лимитов, описанных в `WHATSAPP_STRATEGY.md`.

**SQL для выполнения:**
```sql
-- Ежедневный прирост холодных сообщений (рекомендуется: 5)
INSERT OR IGNORE INTO settings (key, value) VALUES ('sender_daily_limit_step', '5');

-- Максимальный потолок рассылки для трастовых аккаунтов (рекомендуется: 75)
INSERT OR IGNORE INTO settings (key, value) VALUES ('sender_max_daily_limit', '75');

-- Ежедневный прирост сообщений прогрева (рекомендуется: 10)
INSERT OR IGNORE INTO settings (key, value) VALUES ('warmup_daily_step', '10');

-- Максимальный потолок прогрева (рекомендуется: 70)
INSERT OR IGNORE INTO settings (key, value) VALUES ('warmup_max_daily_limit', '70');

-- [NEW] Режим безопасного тестирования (Dry Run)
INSERT OR IGNORE INTO settings (key, value) VALUES ('dry_run_mode', 'true');
```

## 3. Рекомендации по выполнению миграции
Завтра перед стартом сервера `npm run dev`, рекомендуется создать скрипт `migrate.js`, который через `better-sqlite3` выполнит эти команды обернутыми в `try/catch` (чтобы проигнорировать ошибку `duplicate column`, если поля уже существуют).
