# Dr Nabli Mohamed Ali website: working rules

- Stack: plain HTML + vanilla ES5 JS (shared helpers in `client/portal.js`), Supabase auth + Postgres with RLS, no build step. `config.js` holds the public anon key only. Published by GitHub Pages from the `main` root.
- Pages: coach `client/coach.html`, client `client/dashboard.html`.
- Database changes: add `supabase/migrations/NN-*.sql` AND append the same SQL to `supabase/setup-all.sql`. Mohamed runs it by hand in the Supabase SQL Editor. Coach = `profiles.role = 'coach'`.
- This repo is public. Never commit client personal data, secrets or service-role keys.
- Keep changes to what was asked. Read only the files the task needs, once. Use the smallest targeted check. No background agents, scheduled work or unrequested follow-ups.
- Reply to Mohamed in English, short.
