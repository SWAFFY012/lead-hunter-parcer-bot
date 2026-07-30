# LeadHunter CRM

Локальное приложение для сбора лидов и работы с CRM. В проект входят парсеры Telegram, Google Карт и Яндекс Карт.

Исходный проект: [dmitriydrobkin/leadhunter-crm](https://github.com/dmitriydrobkin/leadhunter-crm). Перед коммерческим распространением проверьте лицензию исходного проекта.

## Требования

- Node.js 22 или новее
- Supabase/PostgreSQL для полноценной работы API

## Установка

```powershell
npm.cmd run install:all
Copy-Item backend/.env.example backend/.env
# Укажите собственный SUPABASE_DB_URL в backend/.env
npm.cmd run dev
```

Откройте <http://localhost:5173>. Проверка backend: <http://localhost:3001/api/health>.

Без `SUPABASE_DB_URL` интерфейс работает в ознакомительном режиме с нулевой статистикой. Функции, которым нужна база данных, возвращают HTTP 503.

## Безопасность

Не добавляйте в Git `.env`, базы данных, профили браузера, загруженные данные и сессии мессенджеров. Если секрет раньше попал в репозиторий, замените его.
