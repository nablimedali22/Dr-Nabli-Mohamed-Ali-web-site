-- Teams and clubs for the coach's team dashboard.
-- Run once in Supabase > SQL Editor (after srpe.sql). Safe to run again.
-- Only the coach can see or change teams; players never see teammates.

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
