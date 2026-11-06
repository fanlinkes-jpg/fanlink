create table if not exists of_fan_note (
  creator_id text not null,
  fan_key text not null,
  body text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (creator_id, fan_key)
);
