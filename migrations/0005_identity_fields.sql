alter table of_session_account add column identity_handle text;
alter table of_session_account add column identity_name text;
alter table of_session_account add column identity_user_id text;
alter table of_session_account add column identity_checked_at timestamptz;
