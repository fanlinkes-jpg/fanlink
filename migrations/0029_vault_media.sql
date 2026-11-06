create table if not exists of_vault_folder (
  creator_id text not null,
  folder_id text not null,
  name text not null,
  parent_id text,
  primary key (creator_id, folder_id)
);

create table if not exists of_vault_item (
  creator_id text not null,
  media_id text not null,
  title text,
  kind text,
  seconds integer,
  preview text,
  full_url text,
  created_at timestamptz,
  folder_id text,
  tags text,
  price_cents integer,
  sales integer,
  trailer boolean,
  couple text,
  act text,
  blocked text,
  synced_at timestamptz not null,
  primary key (creator_id, media_id)
);

create table if not exists of_vault_cursor (
  creator_id text primary key,
  cursor_text text,
  done boolean not null default false
);
