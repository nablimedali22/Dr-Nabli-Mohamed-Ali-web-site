-- Nutrition: the coach's nutrition programmes and recommendations, the client's weekly
-- weigh-ins (start and end of each week), supplements, and daily meal photos.
-- Run once in Supabase > SQL Editor > New query (after 02-client-space.sql). Safe to run again.
-- Photos go in the private bucket "client-files" under <client id>/nutrition/; a client can
-- upload and delete only there, and only the client and the coach can open them.

-- ---------- programmes and recommendations, written by the coach ----------
create table if not exists public.nutrition_plans (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'programme' check (kind in ('programme','recommendation')),
  title       text not null check (char_length(title) between 1 and 200),
  body        text check (body is null or char_length(body) <= 10000),
  file_path   text check (file_path is null or split_part(file_path, '/', 1) = client_id::text),
  created_at  timestamptz not null default now()
);

-- ---------- weigh-ins: one at the start and one at the end of each week ----------
create table if not exists public.weight_logs (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  log_date    date not null default current_date,
  moment      text not null check (moment in ('week_start','week_end')),
  weight_kg   numeric(5,1) not null check (weight_kg between 20 and 300),
  notes       text check (notes is null or char_length(notes) <= 500),
  created_at  timestamptz not null default now(),
  unique (client_id, log_date, moment)
);

-- ---------- supplements the client takes ----------
create table if not exists public.supplements (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  name        text not null check (char_length(name) between 1 and 120),
  dose        text check (dose is null or char_length(dose) <= 120),
  timing      text check (timing is null or char_length(timing) <= 120),
  notes       text check (notes is null or char_length(notes) <= 500),
  photo_path  text check (photo_path is null or (split_part(photo_path, '/', 1) = client_id::text and split_part(photo_path, '/', 2) = 'nutrition')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- daily meal photos, with an optional coach comment ----------
create table if not exists public.meal_photos (
  id             bigint generated always as identity primary key,
  client_id      uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  meal_date      date not null default current_date,
  meal           text not null default 'other' check (meal in ('breakfast','lunch','dinner','snack','other')),
  photo_path     text not null check (split_part(photo_path, '/', 1) = client_id::text and split_part(photo_path, '/', 2) = 'nutrition'),
  notes          text check (notes is null or char_length(notes) <= 500),
  coach_comment  text check (coach_comment is null or char_length(coach_comment) <= 1000),
  created_at     timestamptz not null default now()
);

alter table public.nutrition_plans enable row level security;
alter table public.weight_logs enable row level security;
alter table public.supplements enable row level security;
alter table public.meal_photos enable row level security;

-- Programmes: the client reads their own, only the coach writes.
drop policy if exists "read own nutrition plans or coach" on public.nutrition_plans;
create policy "read own nutrition plans or coach" on public.nutrition_plans for select to authenticated
  using (client_id = auth.uid() or public.is_coach());
drop policy if exists "coach manages nutrition plans" on public.nutrition_plans;
create policy "coach manages nutrition plans" on public.nutrition_plans for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

-- Weigh-ins: the client logs, corrects and removes their own from the last 14 days.
drop policy if exists "read own weights or coach" on public.weight_logs;
create policy "read own weights or coach" on public.weight_logs for select to authenticated
  using (client_id = auth.uid() or public.is_coach());
drop policy if exists "client logs own weight" on public.weight_logs;
create policy "client logs own weight" on public.weight_logs for insert to authenticated
  with check (client_id = auth.uid() and log_date between current_date - 14 and current_date + 1);
drop policy if exists "client edits recent weight" on public.weight_logs;
create policy "client edits recent weight" on public.weight_logs for update to authenticated
  using (client_id = auth.uid() and log_date between current_date - 14 and current_date + 1)
  with check (client_id = auth.uid() and log_date between current_date - 14 and current_date + 1);
drop policy if exists "client deletes recent weight" on public.weight_logs;
create policy "client deletes recent weight" on public.weight_logs for delete to authenticated
  using (client_id = auth.uid() and log_date between current_date - 14 and current_date + 1);
drop policy if exists "coach manages weights" on public.weight_logs;
create policy "coach manages weights" on public.weight_logs for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

-- Supplements: the client keeps their own list.
drop policy if exists "client manages own supplements" on public.supplements;
create policy "client manages own supplements" on public.supplements for all to authenticated
  using (client_id = auth.uid() or public.is_coach())
  with check (client_id = auth.uid() or public.is_coach());

-- Meal photos: the client adds and removes their own from the last 7 days; only the coach comments.
drop policy if exists "read own meals or coach" on public.meal_photos;
create policy "read own meals or coach" on public.meal_photos for select to authenticated
  using (client_id = auth.uid() or public.is_coach());
drop policy if exists "client adds own meal" on public.meal_photos;
create policy "client adds own meal" on public.meal_photos for insert to authenticated
  with check (client_id = auth.uid() and coach_comment is null and meal_date between current_date - 7 and current_date + 1);
drop policy if exists "client deletes recent meal" on public.meal_photos;
create policy "client deletes recent meal" on public.meal_photos for delete to authenticated
  using (client_id = auth.uid() and meal_date between current_date - 7 and current_date + 1);
drop policy if exists "coach manages meals" on public.meal_photos;
create policy "coach manages meals" on public.meal_photos for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

revoke all on public.nutrition_plans, public.weight_logs, public.supplements, public.meal_photos from anon;
grant select, insert, update, delete on public.nutrition_plans, public.weight_logs, public.supplements, public.meal_photos to authenticated;
create index if not exists nutrition_plans_client on public.nutrition_plans (client_id, created_at desc);
create index if not exists weight_logs_client_date on public.weight_logs (client_id, log_date);
create index if not exists supplements_client on public.supplements (client_id);
create index if not exists meal_photos_client_date on public.meal_photos (client_id, meal_date desc);

-- Storage: a client may upload to, and delete from, their own nutrition folder only.
drop policy if exists "client uploads nutrition photos" on storage.objects;
create policy "client uploads nutrition photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'client-files' and (storage.foldername(name))[1] = auth.uid()::text and (storage.foldername(name))[2] = 'nutrition');
drop policy if exists "client deletes nutrition photos" on storage.objects;
create policy "client deletes nutrition photos" on storage.objects for delete to authenticated
  using (bucket_id = 'client-files' and (storage.foldername(name))[1] = auth.uid()::text and (storage.foldername(name))[2] = 'nutrition');
