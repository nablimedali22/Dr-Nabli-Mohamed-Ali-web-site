-- s-RPE training load (Foster): load (AU) = session RPE (CR-10, 0-10) x duration (min).
-- Run once in Supabase > SQL Editor (your database is already set up). Safe to run again.

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
