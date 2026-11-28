-- Favorito, avisos silenciados y chat fijado por fan. Se comparte con todo el equipo.
-- Solo del CRM: no se sincroniza con OnlyFans.
create table if not exists of_fan_flag (
  creator_id text not null,
  fan_key text not null,
  favorite boolean not null default false,
  muted boolean not null default false,
  pinned_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (creator_id, fan_key)
);
