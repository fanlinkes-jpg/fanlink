create table if not exists staff_profile (
  user_id text primary key,
  display_name text not null,
  role text not null,
  perms jsonb not null,
  created_at timestamptz not null default now(),
  constraint staff_profile_role_chk check (role in ('owner', 'member'))
);

create table if not exists creator_grant (
  user_id text not null,
  creator_id text not null,
  primary key (user_id, creator_id)
);

alter table of_session_account add column connection_status text not null default 'not_checked';
alter table of_session_account add column identity_state text not null default 'unavailable';
alter table of_session_account add column identity_label text;
