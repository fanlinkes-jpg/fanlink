-- Vínculo entre una creadora del CRM y su sesión de OnlyFans.
-- Las cookies y el localStorage no se guardan aquí: van cifrados en data/sessions.
create table if not exists of_session_account (
  id text primary key,
  creator_id text not null unique,
  label text not null,
  status text not null,
  login_in_progress boolean not null default false,
  session_rejected boolean not null default false,
  has_storage_state boolean not null default false,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint of_session_account_status_chk check (status in ('active', 'expired', 'pending_login'))
);
