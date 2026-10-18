-- Session library, training programs and set-by-set logging.
-- Run once in Supabase > SQL Editor (after 08-session-load.sql). Safe to run again.
--
--   * exercise_library, session_templates and programs belong to the coach only.
--   * Assigning a program copies its sessions into training_sessions for that
--     client, so the client dashboard keeps reading the tables it already uses.
--   * Clients log their own sets (reps, load) on their own session exercises.

-- ---------- client profile: exercises the coach restricts (availability comes from available_days) ----------
alter table public.profiles add column if not exists restrictions text;                       -- exercises to avoid, one per line

-- Clients may edit only their contact and personal fields, never role/active/email/restrictions.
create or replace function public.guard_profile_update()
returns trigger language plpgsql as $$
begin
  if current_user in ('anon','authenticated') and not public.is_coach() then
    if new.role is distinct from old.role or new.active is distinct from old.active
       or new.email is distinct from old.email or new.id is distinct from old.id
       or new.restrictions is distinct from old.restrictions then
      raise exception 'Only the coach can change this field';
    end if;
  end if;
  return new;
end $$;

-- ---------- exercise library ----------
create table if not exists public.exercise_library (
  id          bigint generated always as identity primary key,
  name        text not null unique check (char_length(name) between 1 and 120),
  category    text not null default 'strength' check (category in ('strength','speed','power','conditioning','core','mobility')),
  demo_url    text check (demo_url is null or demo_url ~ '^https?://'),
  cue         text check (cue is null or char_length(cue) <= 300),
  created_at  timestamptz not null default now()
);

-- ---------- reusable sessions, by objective ----------
create table if not exists public.session_templates (
  id           bigint generated always as identity primary key,
  name         text not null check (char_length(name) between 1 and 120),
  category     text not null default 'strength' check (category in ('strength','speed','power','conditioning','core','mobility')),
  duration_min int check (duration_min is null or duration_min between 1 and 600),
  focus        text,
  coach_notes  text,
  created_at   timestamptz not null default now()
);

create table if not exists public.template_exercises (
  id          bigint generated always as identity primary key,
  template_id bigint not null references public.session_templates(id) on delete cascade,
  position    int not null default 1,
  name        text not null,
  sets        int,
  reps        text,
  load        text,
  target_rpe  numeric(3,1),
  rest        text,
  notes       text,
  demo_url    text check (demo_url is null or demo_url ~ '^https?://')
);

-- ---------- programs: sessions placed on days, for one or more weeks ----------
create table if not exists public.programs (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(name) between 1 and 120),
  description text,
  weeks       int not null default 4 check (weeks between 1 and 52),
  created_at  timestamptz not null default now()
);

create table if not exists public.program_sessions (
  id          bigint generated always as identity primary key,
  program_id  bigint not null references public.programs(id) on delete cascade,
  week        int not null default 0 check (week between 0 and 52),   -- 0 = every week
  day_of_week int not null check (day_of_week between 0 and 6),       -- 0 = Monday
  template_id bigint not null references public.session_templates(id) on delete cascade
);

create table if not exists public.program_assignments (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.profiles(id) on delete cascade,
  program_id  bigint references public.programs(id) on delete set null,
  program_name text not null,          -- kept if the program is deleted later
  start_date  date not null,
  weeks       int not null,
  created_at  timestamptz not null default now()
);

-- ---------- link generated sessions back to their source ----------
alter table public.training_sessions add column if not exists assignment_id bigint references public.program_assignments(id) on delete set null;
alter table public.training_sessions add column if not exists template_id bigint references public.session_templates(id) on delete set null;
alter table public.training_sessions add column if not exists duration_min int check (duration_min is null or duration_min between 1 and 600);
alter table public.session_exercises add column if not exists demo_url text check (demo_url is null or demo_url ~ '^https?://');

-- Clients may only report on their own sessions (done, RPE, feedback).
create or replace function public.guard_session_update()
returns trigger language plpgsql as $$
begin
  if current_user in ('anon','authenticated') and not public.is_coach() then
    if (new.client_id, new.session_date, new.title, new.focus, new.coach_notes, new.pdf_path, new.assignment_id, new.template_id, new.duration_min)
       is distinct from (old.client_id, old.session_date, old.title, old.focus, old.coach_notes, old.pdf_path, old.assignment_id, old.template_id, old.duration_min) then
      raise exception 'Clients can only update completion, RPE and feedback';
    end if;
  end if;
  return new;
end $$;

-- ---------- set logs: what the client actually did, set by set ----------
create table if not exists public.set_logs (
  id          bigint generated always as identity primary key,
  exercise_id bigint not null references public.session_exercises(id) on delete cascade,
  client_id   uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  set_no      int not null check (set_no between 1 and 50),
  reps        text check (reps is null or char_length(reps) <= 20),
  load        text check (load is null or char_length(load) <= 20),
  created_at  timestamptz not null default now(),
  unique (exercise_id, set_no)
);

-- client_id always comes from the exercise, so nobody can log against another client's session.
create or replace function public.set_log_client_from_exercise()
returns trigger language plpgsql as $$
begin
  select client_id into new.client_id from public.session_exercises where id = new.exercise_id;
  return new;
end $$;
drop trigger if exists set_log_client_from_exercise on public.set_logs;
create trigger set_log_client_from_exercise before insert or update on public.set_logs
  for each row execute function public.set_log_client_from_exercise();

-- ---------- Row Level Security ----------
alter table public.exercise_library    enable row level security;
alter table public.session_templates   enable row level security;
alter table public.template_exercises  enable row level security;
alter table public.programs            enable row level security;
alter table public.program_sessions    enable row level security;
alter table public.program_assignments enable row level security;
alter table public.set_logs            enable row level security;

do $$
declare t text;
begin
  foreach t in array array['exercise_library','session_templates','template_exercises','programs','program_sessions'] loop
    execute format('drop policy if exists "coach manages" on public.%I', t);
    execute format('create policy "coach manages" on public.%I for all to authenticated using (public.is_coach()) with check (public.is_coach())', t);
  end loop;
end $$;

drop policy if exists "client reads own" on public.program_assignments;
create policy "client reads own" on public.program_assignments for select to authenticated
  using (client_id = auth.uid() or public.is_coach());
drop policy if exists "coach writes" on public.program_assignments;
create policy "coach writes" on public.program_assignments for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

drop policy if exists "read own sets or coach" on public.set_logs;
create policy "read own sets or coach" on public.set_logs for select to authenticated
  using (client_id = auth.uid() or public.is_coach());
drop policy if exists "client logs own sets" on public.set_logs;
create policy "client logs own sets" on public.set_logs for insert to authenticated
  with check (client_id = auth.uid());
drop policy if exists "client edits own sets" on public.set_logs;
create policy "client edits own sets" on public.set_logs for update to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());
drop policy if exists "client deletes own sets" on public.set_logs;
create policy "client deletes own sets" on public.set_logs for delete to authenticated
  using (client_id = auth.uid());
drop policy if exists "coach manages sets" on public.set_logs;
create policy "coach manages sets" on public.set_logs for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

revoke all on public.exercise_library, public.session_templates, public.template_exercises, public.programs,
  public.program_sessions, public.program_assignments, public.set_logs from anon;
grant select, insert, update, delete on public.exercise_library, public.session_templates, public.template_exercises, public.programs,
  public.program_sessions, public.program_assignments, public.set_logs to authenticated;

create index if not exists template_exercises_template on public.template_exercises (template_id, position);
create index if not exists program_sessions_program on public.program_sessions (program_id, week, day_of_week);
create index if not exists program_assignments_client on public.program_assignments (client_id, start_date desc);
create index if not exists training_sessions_assignment on public.training_sessions (assignment_id);
create index if not exists set_logs_exercise on public.set_logs (exercise_id, set_no);

-- ---------- starter exercises (skipped if a name already exists) ----------
insert into public.exercise_library (name, category, cue) values
  ('Back squat','strength','Brace, sit between the hips, drive the floor away.'),
  ('Romanian deadlift','strength','Soft knees, hips back, bar against the legs.'),
  ('Trap bar deadlift','strength','Push the floor away, stand tall.'),
  ('Bulgarian split squat','strength','Weight on the front foot, control the way down.'),
  ('Bench press','strength','Shoulder blades pinned, bar to lower chest.'),
  ('Pull-up','strength','Full hang to chin over bar.'),
  ('Wall drill A-march','speed','45° lean, knee up, foot lands under the hip.'),
  ('Sled push','speed','Low body angle, long pushes.'),
  ('10 m acceleration','speed','Push, do not reach. Full recovery.'),
  ('Flying 30 m sprint','speed','20 m build-in, 30 m at true max speed.'),
  ('Box jump','power','Jump high, land soft, step down.'),
  ('Depth jump','power','Step off, minimal ground time, jump straight up.'),
  ('Broad jump','power','Big arm swing, stick the landing.'),
  ('Hang power clean','power','Bar from mid-thigh, fast elbows.'),
  ('Tempo run 100 m','conditioning','70% of max speed, relaxed shoulders.'),
  ('Air bike interval','conditioning','Hard effort, then spin easy.'),
  ('Nordic hamstring curl','core','Hips extended, lower as slowly as you can.'),
  ('Copenhagen plank','core','Hips in line, adductors working.'),
  ('Pallof press','core','Resist rotation, press out slowly.'),
  ('Dead bug','core','Low back stays flat on the floor.'),
  ('90/90 hip switch','mobility','Tall chest, rotate from the hips.'),
  ('World''s greatest stretch','mobility','Lunge, elbow to instep, rotate up.'),
  ('Couch stretch','mobility','Squeeze the glute of the back leg.'),
  ('Foam roll quads and glutes','mobility','Slow passes, pause on tight spots.')
on conflict (name) do nothing;
