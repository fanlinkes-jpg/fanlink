-- Empleados: nivel (rol visible en Personal), estado y correo en la ficha, e invitaciones de un solo uso.
-- `role` sigue siendo owner o member. `level` solo marca el nivel; la matriz de permisos por nivel va aparte.
alter table staff_profile add column if not exists email text;
alter table staff_profile add column if not exists level text not null default 'chatter';
alter table staff_profile add column if not exists status text not null default 'active';
alter table staff_profile add column if not exists disabled_at timestamptz;

update staff_profile set level = 'owner' where role = 'owner';

alter table staff_profile add constraint staff_profile_level_chk
  check (level in ('owner', 'chatter', 'account_manager', 'team_manager', 'supervisor', 'analyst'));
-- active: entra. disabled: sin sesión ni acceso.
alter table staff_profile add constraint staff_profile_status_chk
  check (status in ('active', 'disabled'));

create unique index if not exists staff_profile_email_uidx on staff_profile (lower(email)) where email is not null;

create table if not exists staff_invite (
  id text primary key,
  token_hash text not null unique,
  name text not null,
  email text not null,
  level text not null,
  perms jsonb not null default '["mensajes"]'::jsonb,
  creator_ids jsonb not null default '[]'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by text,
  revoked_at timestamptz,
  constraint staff_invite_level_chk
    check (level in ('chatter', 'account_manager', 'team_manager', 'supervisor', 'analyst'))
);

create index if not exists staff_invite_email_idx on staff_invite (lower(email));
