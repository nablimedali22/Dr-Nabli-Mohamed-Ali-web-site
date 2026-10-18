-- Allow RPE 0 on training sessions, so the player's rating uses the same 0-10 scale as s-RPE.
-- Run once in Supabase > SQL Editor > New query (after 02-client-space.sql). Safe to run again.
alter table public.training_sessions drop constraint if exists training_sessions_client_rpe_check;
alter table public.training_sessions add constraint training_sessions_client_rpe_check
  check (client_rpe is null or client_rpe between 0 and 10);
