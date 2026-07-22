# LeadHunter CRM

Local lead collection and CRM app with parsers for Google Maps, Instagram, and OLX.

Source snapshot: [dmitriydrobkin/leadhunter-crm](https://github.com/dmitriydrobkin/leadhunter-crm). This repository keeps attribution to the original project. Verify upstream licensing before commercial redistribution.

## Requirements

- Node.js 22+
- Supabase/PostgreSQL database for full API operation

## Setup

```powershell
npm.cmd run install:all
Copy-Item backend/.env.example backend/.env
# Edit backend/.env and set your own SUPABASE_DB_URL
npm.cmd run dev
```

Open <http://localhost:5173>. Backend health check: <http://localhost:3001/api/health>.

Without `SUPABASE_DB_URL`, UI and health check still start, but database-backed routes return HTTP 503.

## Security

Never commit `.env`, database files, browser profiles, downloaded data, or messaging sessions. Rotate any credential that was previously committed to another repository.
