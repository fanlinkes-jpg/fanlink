-- Espejo de la bóveda. Idempotente: no borra filas ni tira tablas.
-- Si la 0029 antigua ya creó of_vault_item (media_id) u of_vault_folder,
-- se añaden columnas y se copia la clave.

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
  sales_count integer,
  sent_count integer,
  synced_at timestamptz not null default now(),
  primary key (creator_id, item_key)
);

alter table of_vault_item add column if not exists item_key text;
alter table of_vault_item add column if not exists title text;
alter table of_vault_item add column if not exists kind text;
alter table of_vault_item add column if not exists seconds integer;
alter table of_vault_item add column if not exists preview text;
alter table of_vault_item add column if not exists folder text;
alter table of_vault_item add column if not exists list_key text;
alter table of_vault_item add column if not exists list_name text;
alter table of_vault_item add column if not exists description text;
alter table of_vault_item add column if not exists uploaded_at timestamptz;
alter table of_vault_item add column if not exists price_cents integer;
alter table of_vault_item add column if not exists sales_count integer;
alter table of_vault_item add column if not exists sent_count integer;
alter table of_vault_item add column if not exists synced_at timestamptz default now();
alter table of_vault_item add column if not exists media_id text;
alter table of_vault_item add column if not exists folder_id text;
alter table of_vault_item add column if not exists created_at timestamptz;
alter table of_vault_item add column if not exists sales integer;
alter table of_vault_item add column if not exists tags jsonb default '[]'::jsonb;

update of_vault_item
set item_key = media_id
where item_key is null
  and media_id is not null;

update of_vault_item
set uploaded_at = created_at
where uploaded_at is null
  and created_at is not null;

update of_vault_item
set list_key = folder_id
where list_key is null
  and folder_id is not null;

update of_vault_item
set sales_count = sales
where sales_count is null
  and sales is not null;

create unique index if not exists of_vault_item_creator_item_key
  on of_vault_item (creator_id, item_key);

create table if not exists of_vault_list (
  creator_id text not null,
  list_key text not null,
  name text not null,
  parent_key text,
  synced_at timestamptz not null default now(),
  primary key (creator_id, list_key)
);

alter table of_vault_list add column if not exists parent_key text;

create table if not exists of_vault_folder (
  creator_id text not null,
  folder_id text not null,
  name text not null,
  parent_id text,
  primary key (creator_id, folder_id)
);

insert into of_vault_list (creator_id, list_key, name, parent_key)
select creator_id, folder_id, name, parent_id
from of_vault_folder
on conflict (creator_id, list_key) do nothing;

create table if not exists of_vault_sync (
  creator_id text primary key,
  synced_at timestamptz,
  cursor_key text
);
