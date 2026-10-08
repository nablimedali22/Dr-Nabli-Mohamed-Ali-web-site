-- =====================================================================
-- Client Space for Dr Mohamed Ali Nabli's coaching website
-- Run once in Supabase > SQL Editor > New query (after schema.sql).
--
-- Security model (enforced by the database, not by the web pages):
--   * Every client row carries client_id = the client's auth user id.
--   * A client can read only rows where client_id = auth.uid().
--   * Only the coach (profiles.role = 'coach') can create or change
--     programs, tests, notes and documents, for any client.
--   * Clients can only: edit a few fields of their own profile, mark their
--     own sessions done with feedback, and send messages in their own thread.
--   * Files live in the private bucket "client-files" under
--     <client_id>/..., and a client can only download files in their folder.
-- =====================================================================

-- ---------- profiles (one per login) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'client' check (role in ('client','coach')),
  phone       text,
  sport       text,
  birth_year  int check (birth_year is null or birth_year between 1930 and 2030),
  height_cm   numeric(5,1),
  goals       text,
  injuries    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Who is the coach? SECURITY DEFINER so policies can call it without recursion.
create or replace function public.is_coach()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'coach');
$$;
revoke all on function public.is_coach() from public;
grant execute on function public.is_coach() to authenticated;

-- New login -> profile row, always as 'client'. The coach is promoted by hand (see guide).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Clients may edit only their contact and personal fields, never role/active/email.
create or replace function public.guard_profile_update()
returns trigger language plpgsql as $$
begin
  -- the SQL editor / dashboard (admin) is not limited; website users are
  if current_user in ('anon','authenticated') and not public.is_coach() then
    if new.role is distinct from old.role or new.active is distinct from old.active
       or new.email is distinct from old.email or new.id is distinct from old.id then
      raise exception 'Only the coach can change this field';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

alter table public.profiles enable row level security;
drop policy if exists "read own profile or coach" on public.profiles;
create policy "read own profile or coach" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_coach());
drop policy if exists "update own profile or coach" on public.profiles;
create policy "update own profile or coach" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_coach())
  with check (id = auth.uid() or public.is_coach());

-- ---------- coaching plans ----------
create table if not exists public.coaching_plans (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  goal        text,
  phase       text,
  start_date  date,
  end_date    date,
  details     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- training sessions (daily program, calendar) ----------
create table if not exists public.training_sessions (
  id              bigint generated always as identity primary key,
  client_id       uuid not null references public.profiles(id) on delete cascade,
  session_date    date not null,
  title           text not null,
  focus           text,
  coach_notes     text,
  pdf_path        text,           -- file in bucket client-files, under <client_id>/
  completed       boolean not null default false,
  client_rpe      int check (client_rpe is null or client_rpe between 1 and 10),
  client_feedback text,
  created_at      timestamptz not null default now()
);

-- exercises of a session: sets, reps, load, RPE
create table if not exists public.session_exercises (
  id          bigint generated always as identity primary key,
  session_id  bigint not null references public.training_sessions(id) on delete cascade,
  client_id   uuid not null references public.profiles(id) on delete cascade,
  position    int not null default 1,
  name        text not null,
  sets        int,
  reps        text,      -- "8", "6-8", "30 s"
  load        text,      -- "80 kg", "70% 1RM", "BW"
  target_rpe  numeric(3,1),
  rest        text,
  notes       text
);

-- Clients may only report on their own sessions (done, RPE, feedback).
create or replace function public.guard_session_update()
returns trigger language plpgsql as $$
begin
  if current_user in ('anon','authenticated') and not public.is_coach() then
    if (new.client_id, new.session_date, new.title, new.focus, new.coach_notes, new.pdf_path)
       is distinct from (old.client_id, old.session_date, old.title, old.focus, old.coach_notes, old.pdf_path) then
      raise exception 'Clients can only update completion, RPE and feedback';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_session_update on public.training_sessions;
create trigger guard_session_update before update on public.training_sessions
  for each row execute function public.guard_session_update();

-- Keep an exercise's client_id equal to its session's client_id.
create or replace function public.exercise_client_from_session()
returns trigger language plpgsql as $$
begin
  select client_id into new.client_id from public.training_sessions where id = new.session_id;
  return new;
end $$;
drop trigger if exists exercise_client_from_session on public.session_exercises;
create trigger exercise_client_from_session before insert or update on public.session_exercises
  for each row execute function public.exercise_client_from_session();

-- ---------- assessments: measurements and test results (progress charts) ----------
create table if not exists public.assessments (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.profiles(id) on delete cascade,
  measured_on date not null default current_date,
  category    text not null default 'test' check (category in ('test','measurement')),
  name        text not null,          -- "CMJ", "Yo-Yo IR1", "Body mass", "Back squat 1RM"
  value       numeric not null,
  unit        text,
  higher_is_better boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);

-- ---------- coach notes (private ones stay hidden from the client) ----------
create table if not exists public.coach_notes (
  id                bigint generated always as identity primary key,
  client_id         uuid not null references public.profiles(id) on delete cascade,
  note_date         date not null default current_date,
  title             text,
  body              text not null,
  visible_to_client boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ---------- documents: reports, PDFs, assessments, progress photos ----------
create table if not exists public.documents (
  id           bigint generated always as identity primary key,
  client_id    uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  kind         text not null default 'report' check (kind in ('program','report','assessment','photo','other')),
  storage_path text not null,         -- <client_id>/<file>
  created_at   timestamptz not null default now(),
  constraint documents_path_in_client_folder check (split_part(storage_path, '/', 1) = client_id::text)
);

-- ---------- messages between client and coach ----------
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  client_id  uuid not null references public.profiles(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body       text not null check (char_length(body) between 1 and 4000),
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Row Level Security on every client table ----------
alter table public.coaching_plans    enable row level security;
alter table public.training_sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.assessments       enable row level security;
alter table public.coach_notes       enable row level security;
alter table public.documents         enable row level security;
alter table public.messages          enable row level security;

do $$
declare t text;
begin
  -- read: own rows, or everything for the coach; write: coach only
  foreach t in array array['coaching_plans','training_sessions','session_exercises','assessments','documents'] loop
    execute format('drop policy if exists "client reads own" on public.%I', t);
    execute format('create policy "client reads own" on public.%I for select to authenticated using (client_id = auth.uid() or public.is_coach())', t);
    execute format('drop policy if exists "coach writes" on public.%I', t);
    execute format('create policy "coach writes" on public.%I for all to authenticated using (public.is_coach()) with check (public.is_coach())', t);
  end loop;
end $$;

-- clients report on their own sessions (the trigger limits which columns)
drop policy if exists "client reports own session" on public.training_sessions;
create policy "client reports own session" on public.training_sessions for update to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());

-- coach notes: clients see only the ones marked visible
drop policy if exists "client reads visible notes" on public.coach_notes;
create policy "client reads visible notes" on public.coach_notes for select to authenticated
  using ((client_id = auth.uid() and visible_to_client) or public.is_coach());
drop policy if exists "coach writes notes" on public.coach_notes;
create policy "coach writes notes" on public.coach_notes for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

-- messages: each client has one thread with the coach
drop policy if exists "read own thread" on public.messages;
create policy "read own thread" on public.messages for select to authenticated
  using (client_id = auth.uid() or public.is_coach());
drop policy if exists "client writes in own thread" on public.messages;
create policy "client writes in own thread" on public.messages for insert to authenticated
  with check (client_id = auth.uid() and sender_id = auth.uid());
drop policy if exists "coach writes in any thread" on public.messages;
create policy "coach writes in any thread" on public.messages for insert to authenticated
  with check (public.is_coach() and sender_id = auth.uid());
drop policy if exists "mark read" on public.messages;
create policy "mark read" on public.messages for update to authenticated
  using ((client_id = auth.uid() and sender_id <> auth.uid()) or public.is_coach())
  with check ((client_id = auth.uid() and sender_id <> auth.uid()) or public.is_coach());
drop policy if exists "coach deletes messages" on public.messages;
create policy "coach deletes messages" on public.messages for delete to authenticated
  using (public.is_coach());

-- Clients may only change read_at on a message they received.
create or replace function public.guard_message_update()
returns trigger language plpgsql as $$
begin
  if current_user in ('anon','authenticated') and not public.is_coach() and (new.body, new.client_id, new.sender_id, new.created_at)
     is distinct from (old.body, old.client_id, old.sender_id, old.created_at) then
    raise exception 'Messages cannot be edited';
  end if;
  return new;
end $$;
drop trigger if exists guard_message_update on public.messages;
create trigger guard_message_update before update on public.messages
  for each row execute function public.guard_message_update();

-- Public (not logged in) visitors get nothing from these tables.
revoke all on public.profiles, public.coaching_plans, public.training_sessions, public.session_exercises,
  public.assessments, public.coach_notes, public.documents, public.messages from anon;
grant select, insert, update, delete on public.profiles, public.coaching_plans, public.training_sessions,
  public.session_exercises, public.assessments, public.coach_notes, public.documents, public.messages to authenticated;

create index if not exists training_sessions_client_date on public.training_sessions (client_id, session_date);
create index if not exists session_exercises_session on public.session_exercises (session_id, position);
create index if not exists assessments_client_name_date on public.assessments (client_id, name, measured_on);
create index if not exists coach_notes_client on public.coach_notes (client_id, note_date desc);
create index if not exists documents_client on public.documents (client_id, created_at desc);
create index if not exists messages_client on public.messages (client_id, created_at);

-- ---------- private file storage ----------
insert into storage.buckets (id, name, public)
values ('client-files', 'client-files', false)
on conflict (id) do update set public = false;

drop policy if exists "client reads own files" on storage.objects;
create policy "client reads own files" on storage.objects for select to authenticated
  using (bucket_id = 'client-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_coach()));
drop policy if exists "coach uploads files" on storage.objects;
create policy "coach uploads files" on storage.objects for insert to authenticated
  with check (bucket_id = 'client-files' and public.is_coach());
drop policy if exists "coach updates files" on storage.objects;
create policy "coach updates files" on storage.objects for update to authenticated
  using (bucket_id = 'client-files' and public.is_coach());
drop policy if exists "coach deletes files" on storage.objects;
create policy "coach deletes files" on storage.objects for delete to authenticated
  using (bucket_id = 'client-files' and public.is_coach());

-- ---------- wellness: daily Hooper index (0 = best, 7 = worst) ----------
create table if not exists public.wellness_entries (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  entry_date  date not null,
  sleep       int not null check (sleep between 0 and 7),
  stress      int not null check (stress between 0 and 7),
  fatigue     int not null check (fatigue between 0 and 7),
  soreness    int not null check (soreness between 0 and 7),
  hooper      int generated always as (sleep + stress + fatigue + soreness) stored,
  comment     text check (comment is null or char_length(comment) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (client_id, entry_date)
);
alter table public.wellness_entries enable row level security;

drop policy if exists "read own wellness or coach" on public.wellness_entries;
create policy "read own wellness or coach" on public.wellness_entries for select to authenticated
  using (client_id = auth.uid() or public.is_coach());
-- Clients log and correct only their own, recent days (1-day margin covers time zones).
drop policy if exists "client logs own wellness" on public.wellness_entries;
create policy "client logs own wellness" on public.wellness_entries for insert to authenticated
  with check (client_id = auth.uid() and entry_date between current_date - 1 and current_date + 1);
drop policy if exists "client edits recent wellness" on public.wellness_entries;
create policy "client edits recent wellness" on public.wellness_entries for update to authenticated
  using (client_id = auth.uid() and entry_date between current_date - 1 and current_date + 1)
  with check (client_id = auth.uid() and entry_date between current_date - 1 and current_date + 1);
drop policy if exists "coach manages wellness" on public.wellness_entries;
create policy "coach manages wellness" on public.wellness_entries for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists wellness_touch on public.wellness_entries;
create trigger wellness_touch before update on public.wellness_entries
  for each row execute function public.touch_updated_at();

revoke all on public.wellness_entries from anon;
grant select, insert, update, delete on public.wellness_entries to authenticated;
create index if not exists wellness_client_date on public.wellness_entries (client_id, entry_date desc);

