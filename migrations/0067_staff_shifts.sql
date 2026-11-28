-- Horarios de Turnos (entrada y salida, o Libre) en zona Europe/Madrid.
-- weekday: 0 = lunes … 6 = domingo. Un turno con salida menor o igual que la entrada pasa de medianoche.
create table if not exists staff_shift (
  user_id text not null,
  weekday smallint not null,
  start_minutes smallint,
  end_minutes smallint,
  is_off boolean not null default true,
  timezone text not null default 'Europe/Madrid',
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (user_id, weekday),
  constraint staff_shift_weekday_chk check (weekday >= 0 and weekday <= 6),
  constraint staff_shift_off_chk check (
    (is_off = true and start_minutes is null and end_minutes is null)
    or (is_off = false and start_minutes between 0 and 1439 and end_minutes between 0 and 1439)
  )
);

-- Un aviso de retraso por persona y día de inicio del turno (no se repite).
create table if not exists staff_shift_late (
  user_id text not null,
  shift_date date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, shift_date)
);

-- Avisos internos del CRM (retraso de turno) para dueña, Admin y Supervisor.
create table if not exists staff_notice (
  id text primary key,
  kind text not null,
  recipient_id text not null,
  about_user_id text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists staff_notice_recipient_idx on staff_notice (recipient_id, created_at desc);
