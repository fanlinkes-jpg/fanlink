-- Historial por fan y la combinación de filtros de cada chatter.
-- Idempotente. No borra envíos ni filtros ya guardados.

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

create index if not exists of_vault_fan_send_lookup
  on of_vault_fan_send (creator_id, fan_key, item_key);

create table if not exists of_vault_filter (
  user_id text primary key,
  query jsonb not null,
  updated_at timestamptz not null default now()
);
