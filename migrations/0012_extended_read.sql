create table if not exists of_transaction (
  creator_id text not null,
  tx_key text not null,
  occurred_at timestamptz not null,
  gross_cents integer not null,
  net_cents integer,
  kind text not null,
  fan_key text,
  currency text not null,
  synced_at timestamptz not null,
  origin text not null default 'onlyfans',
  primary key (creator_id, tx_key),
  constraint of_transaction_kind_chk check (
    kind in ('subscription', 'renewal', 'tip', 'message', 'post', 'stream', 'referral')
  ),
  constraint of_transaction_origin_chk check (origin = 'onlyfans')
);

alter table of_fan_read add column renew_auto boolean;
alter table of_fan_read add column expires_at timestamptz;

alter table of_sync_state add column tx_cursor timestamptz;
