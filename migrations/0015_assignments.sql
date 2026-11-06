create table if not exists of_assignment (
  id text primary key,
  creator_id text not null,
  user_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz
);

create index if not exists of_assignment_creator_idx on of_assignment (creator_id, started_at);
