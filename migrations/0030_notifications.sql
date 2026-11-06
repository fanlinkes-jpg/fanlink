create table if not exists of_notification (
  creator_id text not null,
  notification_key text not null,
  kind text not null,
  body text,
  fan_key text,
  fan_name text,
  thread_key text,
  amount_cents integer,
  occurred_at timestamptz,
  pending boolean not null default false,
  seen_at timestamptz,
  synced_at timestamptz not null,
  origin text not null default 'onlyfans',
  primary key (creator_id, notification_key),
  constraint of_notification_origin_chk check (origin = 'onlyfans')
);

create table if not exists of_notification_sync (
  creator_id text primary key,
  last_attempt_at timestamptz,
  consecutive_failures integer not null default 0,
  last_status text not null default 'idle',
  last_reason text
);
