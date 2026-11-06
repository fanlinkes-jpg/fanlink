create table if not exists staff_profile (
  user_id text primary key,
  display_name text not null,
  role text not null,
  perms jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table of_chat_message add column author_id text references staff_profile (user_id) on delete set null;

create table if not exists of_chat_outbound (
  id text primary key,
  creator_id text not null,
  thread_key text,
  fan_key text,
  author_id text not null references staff_profile (user_id) on delete cascade,
  body text not null,
  price_cents integer,
  created_at timestamptz not null default now(),
  of_message_key text,
  matched_message_key text
);
