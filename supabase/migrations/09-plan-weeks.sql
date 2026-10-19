-- Weekly programmes: under each coaching plan, one file (Word or PDF) per week of the plan.
-- The coach uploads them; the client sees and downloads them on the dashboard.
-- Run once in Supabase > SQL Editor > New query (after 02-client-space.sql). Safe to run again.

create table if not exists public.plan_weeks (
  id           bigint generated always as identity primary key,
  plan_id      bigint not null references public.coaching_plans(id) on delete cascade,
  client_id    uuid not null references public.profiles(id) on delete cascade,
  week_no      int not null check (week_no between 1 and 60),
  file_name    text,
  storage_path text not null,         -- <client_id>/<file>
  created_at   timestamptz not null default now(),
  constraint plan_weeks_plan_week_key unique (plan_id, week_no),
  constraint plan_weeks_path_in_client_folder check (split_part(storage_path, '/', 1) = client_id::text)
);

-- A week file belongs to the plan's client.
create or replace function public.plan_week_client()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select client_id into new.client_id from public.coaching_plans where id = new.plan_id;
  if new.client_id is null then raise exception 'Unknown plan'; end if;
  return new;
end $$;
revoke all on function public.plan_week_client() from public;
drop trigger if exists plan_week_client on public.plan_weeks;
create trigger plan_week_client before insert or update on public.plan_weeks
  for each row execute function public.plan_week_client();

alter table public.plan_weeks enable row level security;
drop policy if exists "client reads own" on public.plan_weeks;
create policy "client reads own" on public.plan_weeks for select to authenticated
  using (client_id = auth.uid() or public.is_coach());
drop policy if exists "coach writes" on public.plan_weeks;
create policy "coach writes" on public.plan_weeks for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

revoke all on public.plan_weeks from anon;
grant select, insert, update, delete on public.plan_weeks to authenticated;
create index if not exists plan_weeks_client on public.plan_weeks (client_id, plan_id, week_no);
