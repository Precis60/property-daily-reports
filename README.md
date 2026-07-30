# Property Daily Reports

Daily work report system for property maintenance staff, with a PIN-gated manager dashboard.

- **Worker view** — staff pick their name, enter their PIN, and submit a daily field report (tasks, hours, photos, delays, tomorrow's plan).
- **Manager view** — PIN-gated morning brief, assigned tasks, full searchable log (with permanent delete for mistaken reports), staff PIN management, and JSON backup/restore.

Data is stored in Supabase (`reports`, `assigned_tasks`, `app_settings`) via the REST API.

## Live site

Published with GitHub Pages: https://precis60.github.io/property-daily-reports/

## Local development

```bash
npm install
npm run dev
```

## Configuration

The Supabase project URL and anon key are read from build-time env vars, falling back to the values baked into `src/App.jsx`:

```
VITE_SUPABASE_URL=https://<project>.supabase.co/rest/v1
VITE_SUPABASE_ANON_KEY=<anon key>
```

Put them in `.env.local` for local dev, or in repository **Variables** (`Settings → Secrets and variables → Actions → Variables`) for the Pages deploy.

## Database schema

See [`supabase/schema.sql`](supabase/schema.sql).

## Security note

The anon key is public by design (it ships in the browser bundle). Access control must therefore be enforced with Supabase Row Level Security policies — the PIN screens in this app are a UI convenience, not a security boundary. Anyone with the anon key can read/write any table the policies allow.
