create table if not exists staff_alert (
  user_id text primary key,
  phone text,
  alerts_enabled boolean not null default false,
  quiet_minutes integer not null default 15,
  constraint staff_alert_quiet_chk check (quiet_minutes >= 1 and quiet_minutes <= 1440)
);

create table if not exists alert_delivery (
  id text primary key,
  user_id text not null,
  creator_id text not null,
  fan_key text not null,
  sent_at timestamptz not null,
  provider text not null,
  simulated boolean not null
);
