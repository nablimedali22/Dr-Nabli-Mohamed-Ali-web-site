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
