-- Sessions logged by the client (team training, self-training...), several per day, each with
-- its RPE; the coach's programme sessions join the same daily load once the client gives the duration.
-- Run once in Supabase > SQL Editor > New query (after 03-srpe.sql). Safe to run again.

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
