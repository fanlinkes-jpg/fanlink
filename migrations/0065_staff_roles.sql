-- Roles múltiples y rol Admin. `level` sigue siendo el rol principal; `roles` guarda todos (vacío = solo `level`).
-- Los permisos finales de cada empleado están en `perms` (preset de sus roles más lo marcado) y se aplican en el servidor.
alter table staff_profile add column if not exists roles jsonb not null default '[]'::jsonb;
alter table staff_invite add column if not exists roles jsonb not null default '[]'::jsonb;

alter table staff_profile drop constraint if exists staff_profile_level_chk;
alter table staff_profile add constraint staff_profile_level_chk
  check (level in ('owner', 'chatter', 'account_manager', 'team_manager', 'supervisor', 'analyst', 'admin'));

alter table staff_invite drop constraint if exists staff_invite_level_chk;
alter table staff_invite add constraint staff_invite_level_chk
  check (level in ('chatter', 'account_manager', 'team_manager', 'supervisor', 'analyst', 'admin'));

-- Última conexión visible en la tabla de Empleados.
alter table staff_profile add column if not exists last_seen_at timestamptz;

-- Las sesiones creadas antes de esta hora ya no valen (cambio de contraseña), aunque la cookie siga en caché.
alter table staff_profile add column if not exists sessions_valid_after timestamptz;

-- Restablecer contraseña: enlace de un solo uso que crea la dueña para un empleado.
create table if not exists staff_reset (
  id text primary key,
  token_hash text not null unique,
  user_id text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists staff_reset_user_idx on staff_reset (user_id);
