create table if not exists of_vault_item (
  creator_id text not null,
  item_key text not null,
  title text,
  kind text,
  seconds integer,
  preview text,
  folder text,
  tags jsonb not null default '[]'::jsonb,
  list_key text,
  list_name text,
  description text,
  uploaded_at timestamptz,
  price_cents integer,
  sales_count integer not null default 0,
  sent_count integer not null default 0,
  synced_at timestamptz not null default now(),
  primary key (creator_id, item_key)
);

create table if not exists of_vault_list (
  creator_id text not null,
  list_key text not null,
  name text not null,
  synced_at timestamptz not null default now(),
  primary key (creator_id, list_key)
);

create table if not exists of_vault_fan_send (
  id text primary key,
  creator_id text not null,
  fan_key text not null,
  item_key text not null,
  sent_at timestamptz,
  price_cents integer,
  purchased boolean,
  author_id text
);

create table if not exists of_vault_sync (
  creator_id text primary key,
  synced_at timestamptz,
  cursor_key text
);

create table if not exists of_vault_filter (
  user_id text primary key,
  query jsonb not null,
  updated_at timestamptz not null default now()
);
