-- Menstrual-cycle tracking for the team "Equipe Nationale FTBB · U16 Fille BB (2026-2027)".
-- Run once in Supabase > SQL Editor (after 10-library-programs.sql). Safe to run again.
--
-- Security model (enforced by the database, not by the web pages):
--   * Only athletes in a team with teams.cycle_tracking = true can use it.
--   * An athlete reads and writes only her own rows (athlete_id = auth.uid()).
--   * The coach reads all rows of cycle-tracking teams and may correct them.
--   * Nothing can be saved for an athlete until the coach has recorded her
--     consent (cycle_consents). Athletes can never record consent themselves.
--   * Cycle numbers are given by the database (1, 2, 3 ... per athlete, in the
--     order cycles are saved) and never change when a cycle is edited.
--   * Cycle day, cycle number on a day, next start, cycle length, period length,
--     max pain and alerts are calculated in views, never typed in.

-- ---------- which team uses cycle tracking ----------
alter table public.teams add column if not exists cycle_tracking boolean not null default false;
update public.teams set cycle_tracking = true
 where (club = 'Equipe Nationale FTBB' and name = 'U16 Fille BB (2026-2027)')
    or name = 'Equipe Nationale FTBB · U16 Fille BB (2026-2027)';

-- The cycle-tracking team of an athlete (null if none). SECURITY DEFINER: athletes cannot read team_members.
create or replace function public.cycle_team_of(uid uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select m.team_id from public.team_members m join public.teams t on t.id = m.team_id
   where m.client_id = uid and t.cycle_tracking order by m.team_id limit 1;
$$;
revoke all on function public.cycle_team_of(uuid) from public;
grant execute on function public.cycle_team_of(uuid) to authenticated;

-- ---------- consent (recorded by the coach only) ----------
create table if not exists public.cycle_consents (
  athlete_id   uuid primary key references public.profiles(id) on delete cascade,
  anon_code    text check (anon_code is null or anon_code ~ '^[A-Za-z0-9-]{1,20}$'),  -- e.g. F-G1-01, used in exports instead of names
  consent_on   date not null,                                                         -- date the signed consent (athlete + guardian) was archived
  recorded_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists cycle_consents_code on public.cycle_consents (anon_code) where anon_code is not null;

create or replace function public.cycle_consent_ok(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.cycle_team_of(uid) is not null and exists (select 1 from public.cycle_consents c where c.athlete_id = uid);
$$;
revoke all on function public.cycle_consent_ok(uuid) from public;
grant execute on function public.cycle_consent_ok(uuid) to authenticated;

-- What the signed-in athlete may do (no other athlete's data is returned).
create or replace function public.cycle_status()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('eligible', public.cycle_team_of(auth.uid()) is not null,
                           'consent', public.cycle_consent_ok(auth.uid()));
$$;
revoke all on function public.cycle_status() from public;
grant execute on function public.cycle_status() to authenticated;

-- Coach access is limited to athletes of cycle-tracking teams.
create or replace function public.cycle_staff_can(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_coach() and public.cycle_team_of(uid) is not null;
$$;
revoke all on function public.cycle_staff_can(uuid) from public;
grant execute on function public.cycle_staff_can(uuid) to authenticated;

-- ---------- one-time profile (Profil initial) ----------
create table if not exists public.cycle_profiles (
  athlete_id         uuid primary key references public.profiles(id) on delete cascade,
  date_of_birth      date check (date_of_birth is null or date_of_birth between '2005-01-01' and '2020-12-31'),
  menarche           text check (menarche is null or menarche in ('yes','no')),
  menarche_age       numeric(3,1) check (menarche_age is null or menarche_age between 8 and 18),
  regularity         text check (regularity is null or regularity in ('regular','irregular','unsure')),
  usual_cycle_days   int check (usual_cycle_days is null or usual_cycle_days between 15 and 60),
  usual_period_days  int check (usual_period_days is null or usual_period_days between 1 and 15),
  contraception      text check (contraception is null or char_length(contraception) <= 200),
  medical_history    text check (medical_history is null or char_length(medical_history) <= 1000),
  height_cm          numeric(4,1) check (height_cm is null or height_cm between 100 and 230),
  weight_kg          numeric(4,1) check (weight_kg is null or weight_kg between 25 and 150),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------- cycles (Résumé par cycle: what is known when bleeding starts) ----------
create table if not exists public.cycles (
  id            bigint generated always as identity primary key,
  athlete_id    uuid not null references public.profiles(id) on delete cascade,
  team_id       bigint references public.teams(id) on delete set null,
  cycle_number  int not null,
  start_date    date not null check (start_date between '2026-09-01' and '2027-08-31'),  -- Cycle Day 1 (first day of bleeding)
  period_end    date,                                                                     -- last day of bleeding, can be added later
  comment       text check (comment is null or char_length(comment) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (athlete_id, start_date),
  unique (athlete_id, cycle_number),
  check (period_end is null or period_end between start_date and start_date + 14)
);

-- Numbers: per-athlete lock, then max + 1, so two saves at the same time cannot get the same number.
create or replace function public.cycles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.start_date > current_date then raise exception 'The start date cannot be in the future'; end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('cycles:' || new.athlete_id::text));
    new.team_id := public.cycle_team_of(new.athlete_id);
    if new.team_id is null then raise exception 'Cycle tracking is not open for this account'; end if;
    select coalesce(max(cycle_number), 0) + 1 into new.cycle_number from public.cycles where athlete_id = new.athlete_id;
  else
    new.athlete_id := old.athlete_id; new.team_id := old.team_id; new.cycle_number := old.cycle_number;
    new.created_at := old.created_at; new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists cycles_guard on public.cycles;
create trigger cycles_guard before insert or update on public.cycles
  for each row execute function public.cycles_guard();

-- ---------- daily log (Journal quotidien) ----------
create table if not exists public.cycle_daily_logs (
  id            bigint generated always as identity primary key,
  athlete_id    uuid not null references public.profiles(id) on delete cascade,
  team_id       bigint references public.teams(id) on delete set null,
  log_date      date not null check (log_date between '2026-11-01' and '2027-08-31'),
  menstruation  boolean,
  flow          text check (flow is null or flow in ('spotting','light','medium','heavy')),
  pain          int check (pain is null or pain between 0 and 10),
  mood          int check (mood is null or mood between 1 and 7),
  energy        int check (energy is null or energy between 1 and 7),
  sleep         int check (sleep is null or sleep between 1 and 7),
  fatigue       int check (fatigue is null or fatigue between 1 and 7),
  main_symptom  text check (main_symptom is null or char_length(main_symptom) <= 80),
  medication    text check (medication is null or char_length(medication) <= 120),
  rpe           int check (rpe is null or rpe between 0 and 10),
  duration_min  int check (duration_min is null or duration_min between 0 and 600),
  availability  text check (availability is null or availability in ('full','limited','absent')),
  comment       text check (comment is null or char_length(comment) <= 500),
  recorded_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (athlete_id, log_date)
);

create or replace function public.cycle_log_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.log_date > current_date then raise exception 'The date cannot be in the future'; end if;
  if tg_op = 'INSERT' then
    new.team_id := public.cycle_team_of(new.athlete_id);
  else
    new.athlete_id := old.athlete_id; new.team_id := old.team_id; new.created_at := old.created_at; new.updated_at := now();
  end if;
  return new;
end $$;

create or replace function public.cycle_row_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.athlete_id := old.athlete_id; new.created_at := old.created_at; new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists cycle_daily_logs_guard on public.cycle_daily_logs;
create trigger cycle_daily_logs_guard before insert or update on public.cycle_daily_logs
  for each row execute function public.cycle_log_guard();
drop trigger if exists cycle_profiles_guard on public.cycle_profiles;
create trigger cycle_profiles_guard before insert or update on public.cycle_profiles
  for each row execute function public.cycle_row_guard();
drop trigger if exists cycle_consents_guard on public.cycle_consents;
create trigger cycle_consents_guard before insert or update on public.cycle_consents
  for each row execute function public.cycle_row_guard();

-- ---------- row level security ----------
alter table public.cycle_consents enable row level security;
alter table public.cycle_profiles enable row level security;
alter table public.cycles enable row level security;
alter table public.cycle_daily_logs enable row level security;

drop policy if exists "read own consent or coach" on public.cycle_consents;
create policy "read own consent or coach" on public.cycle_consents for select to authenticated
  using (athlete_id = auth.uid() or public.cycle_staff_can(athlete_id));
drop policy if exists "coach records consent" on public.cycle_consents;
create policy "coach records consent" on public.cycle_consents for all to authenticated
  using (public.cycle_staff_can(athlete_id)) with check (public.cycle_staff_can(athlete_id));

-- Same rules for the three data tables: own rows (with consent) or coach of the team (with consent).
do $$
declare t text;
begin
  foreach t in array array['cycle_profiles','cycles','cycle_daily_logs'] loop
    execute format('drop policy if exists "read own or coach" on public.%I', t);
    execute format('create policy "read own or coach" on public.%I for select to authenticated
      using (athlete_id = auth.uid() or public.cycle_staff_can(athlete_id))', t);
    execute format('drop policy if exists "add own or coach" on public.%I', t);
    execute format('create policy "add own or coach" on public.%I for insert to authenticated
      with check ((athlete_id = auth.uid() or public.cycle_staff_can(athlete_id)) and public.cycle_consent_ok(athlete_id))', t);
    execute format('drop policy if exists "edit own or coach" on public.%I', t);
    execute format('create policy "edit own or coach" on public.%I for update to authenticated
      using (athlete_id = auth.uid() or public.cycle_staff_can(athlete_id))
      with check ((athlete_id = auth.uid() or public.cycle_staff_can(athlete_id)) and public.cycle_consent_ok(athlete_id))', t);
    execute format('drop policy if exists "coach deletes" on public.%I', t);
    execute format('create policy "coach deletes" on public.%I for delete to authenticated
      using (public.cycle_staff_can(athlete_id))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on public.cycle_consents from anon;
grant select, insert, update, delete on public.cycle_consents to authenticated;
create index if not exists cycle_daily_logs_date on public.cycle_daily_logs (athlete_id, log_date);

-- ---------- calculated views (run with the reader's rights, so RLS applies) ----------
-- Journal quotidien: cycle number and cycle day come from the latest saved cycle start on or before the day.
create or replace view public.cycle_daily_view with (security_invoker = true) as
select d.*, c.cycle_number, c.start_date as cycle_start,
       case when c.start_date is null then null else d.log_date - c.start_date + 1 end as cycle_day,
       case when d.rpe is not null and d.duration_min is not null then d.rpe * d.duration_min end as session_load,
       case when c.start_date is null then null
            when d.menstruation then 'Menstrual'
            when d.log_date - c.start_date + 1 <= coalesce(p.usual_cycle_days, 28) - 15 then 'Follicular'
            when d.log_date - c.start_date + 1 <= coalesce(p.usual_cycle_days, 28) - 12 then 'Ovulatory'
            else 'Luteal' end as estimated_phase
  from public.cycle_daily_logs d
  left join public.cycle_profiles p on p.athlete_id = d.athlete_id
  left join lateral (select c.cycle_number, c.start_date from public.cycles c
                      where c.athlete_id = d.athlete_id and c.start_date <= d.log_date
                      order by c.start_date desc limit 1) c on true;

-- Résumé par cycle.
create or replace view public.cycle_summary_view with (security_invoker = true) as
select s.*, s.next_start - s.start_date as cycle_length,
       coalesce(s.period_end - s.start_date + 1, nullif(s.logged_period_days, 0)) as period_days,
       case when s.next_start is null then null
            when s.next_start - s.start_date < 21 then 'Short (< 21 days)'
            when s.next_start - s.start_date > 35 then 'Long (> 35 days)' end as alert,
       case when s.next_start is null then 'In progress' else 'Complete' end as status
  from (select c.id, c.athlete_id, c.team_id, c.cycle_number, c.start_date, c.period_end, c.comment, c.updated_at,
               lead(c.start_date) over (partition by c.athlete_id order by c.start_date) as next_start,
               (select max(d.pain) from public.cycle_daily_logs d where d.athlete_id = c.athlete_id and d.log_date >= c.start_date
                   and d.log_date < coalesce((select min(n.start_date) from public.cycles n where n.athlete_id = c.athlete_id and n.start_date > c.start_date), 'infinity'::date)) as max_pain,
               (select count(*) from public.cycle_daily_logs d where d.athlete_id = c.athlete_id and d.menstruation
                   and d.log_date between c.start_date and c.start_date + 14
                   and d.log_date < coalesce((select min(n.start_date) from public.cycles n where n.athlete_id = c.athlete_id and n.start_date > c.start_date), 'infinity'::date))::int as logged_period_days
          from public.cycles c) s;

revoke all on public.cycle_daily_view, public.cycle_summary_view from anon;
grant select on public.cycle_daily_view, public.cycle_summary_view to authenticated;

notify pgrst, 'reload schema';
