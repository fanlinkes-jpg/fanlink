create table if not exists workspace_member (
  user_id text primary key,
  joined_at timestamptz not null default now()
);

create table if not exists workspace_state (
  id int primary key default 1,
  state jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text not null
);
