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
