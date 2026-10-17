# Dr Mohamed Ali Nabli website

Live site: https://nablimedali22.github.io/Dr-Nabli-Mohamed-Ali-web-site/

Public site plus a private Client Space (`client/`), hosted on GitHub Pages, with login and data in Supabase.

- The site files sit at the top of this repo. GitHub Pages publishes branch `main`, folder `/ (root)`.
- `config.js` holds the Supabase project URL and the public anon key (safe to publish).
- `supabase/` holds the database setup SQL (run it in the Supabase SQL editor). It contains no passwords or secret keys. On an existing database, run each new file in `supabase/migrations/` once; on a new one, run `setup-all.sql`.
- Coach area: **Session library** (reusable sessions by objective, exercise demo links) and **Programs** (sessions placed on days for several weeks). A client's **Program** tab assigns a program from a start date and warns about unavailable days and restricted exercises. Clients see demo links and log reps and load set by set.
- Contact form messages are saved in the Supabase table `contact_messages` (Table Editor).

Never commit the Supabase service_role key, the database password or any `.env` file.
