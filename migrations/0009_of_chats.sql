alter table of_sync_state add column chat_synced_at timestamptz;
alter table of_sync_state add column chat_last_attempt_at timestamptz;
alter table of_sync_state add column chat_failures integer not null default 0;
alter table of_sync_state add column chat_status text not null default 'idle';
alter table of_sync_state add column chat_reason text;

alter table of_sync_settings add column chat_interval_min integer not null default 2;

create table if not exists of_chat_thread (
  creator_id text not null,
  thread_key text not null,
  fan_key text,
  fan_handle text,
  fan_name text,
  last_message_at timestamptz,
  excerpt text,
  unread integer not null default 0,
  synced_at timestamptz not null,
  origin text not null default 'onlyfans',
  primary key (creator_id, thread_key),
  constraint of_chat_thread_origin_chk check (origin = 'onlyfans')
);

create table if not exists of_chat_message (
  creator_id text not null,
  message_key text not null,
  thread_key text not null,
  fan_key text,
  from_fan boolean not null,
  body text not null,
  sent_at timestamptz not null,
  synced_at timestamptz not null,
  origin text not null default 'onlyfans',
  primary key (creator_id, message_key),
  constraint of_chat_message_origin_chk check (origin = 'onlyfans')
);

create table if not exists of_fan_message_event (
  id text primary key,
  creator_id text not null,
  fan_key text,
  fan_name text,
  excerpt text not null,
  sent_at timestamptz not null,
  created_at timestamptz not null default now()
);
