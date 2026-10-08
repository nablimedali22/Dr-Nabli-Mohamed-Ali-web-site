# Dr Mohamed Ali Nabli website

Live site: https://nablimedali22.github.io/Dr-Nabli-Mohamed-Ali-web-site/

Public site plus a private Client Space (`client/`), hosted on GitHub Pages, with login and data in Supabase.

- The site files sit at the top of this repo. GitHub Pages publishes branch `main`, folder `/ (root)`.
- `config.js` holds the Supabase project URL and the public anon key (safe to publish).
- `supabase/` holds the database setup SQL (run it in the Supabase SQL editor). It contains no passwords or secret keys.
- Contact form messages are saved in the Supabase table `contact_messages` (Table Editor).

Never commit the Supabase service_role key, the database password or any `.env` file.
