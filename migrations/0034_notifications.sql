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
  first_seen_at timestamptz not null default now(),
  synced_at timestamptz not null,
  origin text not null default 'onlyfans',
  primary key (creator_id, notification_key),
  constraint of_notification_origin_chk check (origin = 'onlyfans')
);

-- Si la tabla ya existía sin first_seen_at, el CREATE no añade la columna.
-- El ALTER sí. 0035_notification_first_seen.sql repite el arreglo para una base
-- que ya anotó este fichero con otro nombre. synced_at es la última vez que se
-- vio el aviso, no la primera.
alter table of_notification add column if not exists first_seen_at timestamptz;
update of_notification set first_seen_at = coalesce(first_seen_at, occurred_at, synced_at, now()) where first_seen_at is null;
alter table of_notification alter column first_seen_at set default now();
alter table of_notification alter column first_seen_at set not null;

create table if not exists of_notification_seen (
  creator_id text not null,
  notification_key text not null,
  user_id text not null,
  seen_at timestamptz not null,
  primary key (creator_id, notification_key, user_id)
);

create table if not exists of_notification_sync (
  creator_id text primary key,
  last_attempt_at timestamptz,
  consecutive_failures integer not null default 0,
  last_status text not null default 'idle',
  last_reason text
);
