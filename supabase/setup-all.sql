-- ALL-IN-ONE setup for Dr Nabli's website. Paste everything into Supabase > SQL Editor and click Run. Safe to run again.

-- Contact form messages for Dr Mohamed Ali Nabli's website.
-- Run once in Supabase > SQL Editor > New query.

create table if not exists public.contact_messages (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 1 and 120),
  email       text not null check (char_length(email) between 3 and 200 and email like '%@%'),
  phone       text check (phone is null or char_length(phone) <= 40),
  topic       text check (topic is null or char_length(topic) <= 60),
  message     text not null check (char_length(message) between 1 and 5000),
  status      text not null default 'new' check (status in ('new','replied','archived'))
);

-- Row Level Security: visitors (anon key) may only insert new messages.
-- Nobody can read, change or delete them with the public key; you read them
-- in the Supabase dashboard (Table Editor), which uses your admin access.
alter table public.contact_messages enable row level security;

drop policy if exists "Visitors can send a message" on public.contact_messages;
create policy "Visitors can send a message"
  on public.contact_messages
  for insert
  to anon
  with check (status = 'new');

revoke all on public.contact_messages from anon, authenticated;
grant insert (name, email, phone, topic, message) on public.contact_messages to anon;

create index if not exists contact_messages_created_at_idx
  on public.contact_messages (created_at desc);

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
  client_rpe      int check (client_rpe is null or client_rpe between 0 and 10),
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

-- ---------- s-RPE training load ----------

create table if not exists public.srpe_entries (
  id            bigint generated always as identity primary key,
  client_id     uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  session_date  date not null,
  session_type  text not null default 'Training' check (session_type in ('Training','Match','Gym','Conditioning','Other')),
  rpe           int not null check (rpe between 0 and 10),
  duration_min  int not null check (duration_min between 1 and 600),
  load_au       int generated always as (rpe * duration_min) stored,
  notes         text check (notes is null or char_length(notes) <= 500),
  created_at    timestamptz not null default now()
);
alter table public.srpe_entries enable row level security;

drop policy if exists "read own srpe or coach" on public.srpe_entries;
create policy "read own srpe or coach" on public.srpe_entries for select to authenticated
  using (client_id = auth.uid() or public.is_coach());
-- Clients log, correct and remove only their own sessions from the last 7 days.
drop policy if exists "client logs own srpe" on public.srpe_entries;
create policy "client logs own srpe" on public.srpe_entries for insert to authenticated
  with check (client_id = auth.uid() and session_date between current_date - 7 and current_date + 1);
drop policy if exists "client edits recent srpe" on public.srpe_entries;
create policy "client edits recent srpe" on public.srpe_entries for update to authenticated
  using (client_id = auth.uid() and session_date between current_date - 7 and current_date + 1)
  with check (client_id = auth.uid() and session_date between current_date - 7 and current_date + 1);
drop policy if exists "client deletes recent srpe" on public.srpe_entries;
create policy "client deletes recent srpe" on public.srpe_entries for delete to authenticated
  using (client_id = auth.uid() and session_date between current_date - 7 and current_date + 1);
drop policy if exists "coach manages srpe" on public.srpe_entries;
create policy "coach manages srpe" on public.srpe_entries for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

revoke all on public.srpe_entries from anon;
grant select, insert, update, delete on public.srpe_entries to authenticated;
create index if not exists srpe_client_date on public.srpe_entries (client_id, session_date desc);

-- ---------- teams and clubs (coach only) ----------

create table if not exists public.teams (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(name) between 1 and 80),
  club        text not null default '' check (char_length(club) <= 80),
  sport       text check (sport is null or char_length(sport) <= 60),
  created_at  timestamptz not null default now(),
  unique (club, name)
);

create table if not exists public.team_members (
  team_id    bigint not null references public.teams(id) on delete cascade,
  client_id  uuid not null references public.profiles(id) on delete cascade,
  position   text check (position is null or char_length(position) <= 40),
  added_at   timestamptz not null default now(),
  primary key (team_id, client_id)
);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

drop policy if exists "coach manages teams" on public.teams;
create policy "coach manages teams" on public.teams for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
drop policy if exists "coach manages team members" on public.team_members;
create policy "coach manages team members" on public.team_members for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

revoke all on public.teams, public.team_members from anon;
grant select, insert, update, delete on public.teams, public.team_members to authenticated;
create index if not exists team_members_client on public.team_members (client_id);


-- Client intake profile: the fields of the new-client form (personal, physical, goals,
-- training history, health, availability, lifestyle, consent) on public.profiles.
-- Run once in Supabase > SQL Editor > New query (after 02-client-space.sql). Safe to run again.
-- The client edits these on "My profile", the coach on the client's "Profile" tab;
-- existing row-level security on profiles already limits who can read and change them.

alter table public.profiles
  -- 1. Personal
  add column if not exists intake_date        date,
  add column if not exists birth_date         date,
  add column if not exists sex                text check (sex is null or sex in ('male','female')),
  add column if not exists city               text check (city is null or char_length(city) <= 120),
  add column if not exists occupation         text check (occupation is null or char_length(occupation) <= 120),
  add column if not exists emergency_contact  text check (emergency_contact is null or char_length(emergency_contact) <= 200),
  -- 2. Physical and sport profile
  add column if not exists weight_kg          numeric(5,1) check (weight_kg is null or weight_kg between 20 and 300),
  add column if not exists club_position      text check (club_position is null or char_length(club_position) <= 120),
  add column if not exists level              text check (level is null or level in ('beginner','intermediate','advanced','elite')),
  add column if not exists dominant_side      text check (dominant_side is null or dominant_side in ('right','left')),
  -- 3. Goals (the existing "goals" column holds the specific goal and deadline)
  add column if not exists main_goals         text[],
  add column if not exists next_competition   text check (next_competition is null or char_length(next_competition) <= 300),
  add column if not exists success_definition text check (success_definition is null or char_length(success_definition) <= 1000),
  -- 4. Training history
  add column if not exists training_since     text check (training_since is null or char_length(training_since) <= 120),
  add column if not exists sessions_per_week  int check (sessions_per_week is null or sessions_per_week between 0 and 21),
  add column if not exists recent_training    text[],
  add column if not exists previous_coach     text check (previous_coach is null or char_length(previous_coach) <= 1000),
  add column if not exists best_results       text check (best_results is null or char_length(best_results) <= 1000),
  -- 5. Health (the existing "injuries" column holds past injuries and surgery)
  add column if not exists current_pain       text check (current_pain is null or char_length(current_pain) <= 1000),
  add column if not exists chronic_conditions text check (chronic_conditions is null or char_length(chronic_conditions) <= 1000),
  add column if not exists medications        text check (medications is null or char_length(medications) <= 1000),
  add column if not exists movements_to_avoid text check (movements_to_avoid is null or char_length(movements_to_avoid) <= 1000),
  add column if not exists doctor_no_exercise boolean,
  add column if not exists chest_pain         boolean,
  add column if not exists pregnant           text check (pregnant is null or pregnant in ('yes','no','na')),
  -- 6. Availability
  add column if not exists available_days     text[],
  add column if not exists preferred_time     text[],
  add column if not exists session_minutes    int check (session_minutes is null or session_minutes in (45,60,90)),
  add column if not exists training_location  text[],
  add column if not exists equipment          text check (equipment is null or char_length(equipment) <= 1000),
  add column if not exists training_format    text check (training_format is null or training_format in ('in_person','online','both')),
  -- 7. Lifestyle
  add column if not exists sleep_hours        numeric(3,1) check (sleep_hours is null or sleep_hours between 0 and 24),
  add column if not exists stress_level       int check (stress_level is null or stress_level between 1 and 5),
  add column if not exists work_activity      text check (work_activity is null or work_activity in ('low','moderate','high')),
  add column if not exists diet_notes         text check (diet_notes is null or char_length(diet_notes) <= 1000),
  add column if not exists smoker             boolean,
  -- 8. Consent
  add column if not exists consent            text[];

-- A new or changed weight is also logged as a "Body mass" measurement, so it shows on the progress chart.
-- SECURITY DEFINER because clients cannot insert assessments themselves.
create or replace function public.log_profile_weight()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.weight_kg is not null and (tg_op = 'INSERT' or new.weight_kg is distinct from old.weight_kg) then
    insert into public.assessments (client_id, category, name, value, unit, higher_is_better, notes)
    values (new.id, 'measurement', 'Body mass', new.weight_kg, 'kg', false, 'From profile');
  end if;
  return new;
end $$;
revoke all on function public.log_profile_weight() from public;
drop trigger if exists log_profile_weight on public.profiles;
create trigger log_profile_weight after insert or update of weight_kg on public.profiles
  for each row execute function public.log_profile_weight();

-- =====================================================================
-- Allow RPE 0 on training sessions (same 0-10 scale as s-RPE)
-- =====================================================================
alter table public.training_sessions drop constraint if exists training_sessions_client_rpe_check;
alter table public.training_sessions add constraint training_sessions_client_rpe_check
  check (client_rpe is null or client_rpe between 0 and 10);

-- =====================================================================
-- Nutrition: programmes, weekly weigh-ins, supplements, meal photos
-- =====================================================================

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

-- =====================================================================
-- Client-logged sessions (team training, self-training) and programme sessions in the daily load
-- =====================================================================

-- More session types; 'Training' stays for sessions logged before this change.
alter table public.srpe_entries drop constraint if exists srpe_entries_session_type_check;
alter table public.srpe_entries add constraint srpe_entries_session_type_check
  check (session_type in ('Team training','Self-training','Programme','Training','Match','Gym','Conditioning','Recovery','Other'));

-- Optional name of the session ("Club session, evening").
alter table public.srpe_entries add column if not exists title text check (title is null or char_length(title) <= 120);

-- A programme session (training_sessions) counts once in the load: one entry per session at most.
alter table public.srpe_entries add column if not exists training_session_id bigint
  references public.training_sessions(id) on delete cascade;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'srpe_entries_training_session_key') then
    alter table public.srpe_entries add constraint srpe_entries_training_session_key unique (training_session_id);
  end if;
end $$;

-- A linked entry belongs to the session's client and takes the session's date.
create or replace function public.srpe_from_training_session()
returns trigger language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if new.training_session_id is not null then
    select client_id, session_date into s from public.training_sessions where id = new.training_session_id;
    if not found or s.client_id <> new.client_id then
      raise exception 'This programme session belongs to another client';
    end if;
    new.session_date := s.session_date;
    new.session_type := 'Programme';
  end if;
  return new;
end $$;
revoke all on function public.srpe_from_training_session() from public;
drop trigger if exists srpe_from_training_session on public.srpe_entries;
create trigger srpe_from_training_session before insert or update on public.srpe_entries
  for each row execute function public.srpe_from_training_session();
