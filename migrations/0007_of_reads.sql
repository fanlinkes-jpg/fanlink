create table if not exists of_earning (
  creator_id text not null,
  day date not null,
  kind text not null,
  amount_cents integer not null,
  currency text not null,
  synced_at timestamptz not null,
  origin text not null default 'onlyfans',
  primary key (creator_id, day, kind),
  constraint of_earning_kind_chk check (kind in ('total', 'subscription', 'tip', 'message', 'post')),
  constraint of_earning_origin_chk check (origin = 'onlyfans')
);

create table if not exists of_fan_read (
  creator_id text not null,
  fan_key text not null,
  of_user_id text,
  handle text,
  display_name text,
  subscribed_at timestamptz,
  status text not null,
  spent_cents integer,
  synced_at timestamptz not null,
  origin text not null default 'onlyfans',
  primary key (creator_id, fan_key),
  constraint of_fan_read_status_chk check (status in ('active', 'expired')),
  constraint of_fan_read_origin_chk check (origin = 'onlyfans')
);

create table if not exists of_sync_state (
  creator_id text primary key,
  earnings_synced_at timestamptz,
  fans_synced_at timestamptz,
  last_reason text,
  json_paths text,
  origin text not null default 'onlyfans',
  constraint of_sync_state_origin_chk check (origin = 'onlyfans')
);
