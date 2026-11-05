alter table of_sync_state add column last_attempt_at timestamptz;
alter table of_sync_state add column consecutive_failures integer not null default 0;
alter table of_sync_state add column last_status text not null default 'idle';

create table if not exists of_sync_settings (
  id integer primary key,
  interval_min integer not null,
  constraint of_sync_settings_id_chk check (id = 1),
  constraint of_sync_settings_interval_chk check (interval_min >= 5 and interval_min <= 1440)
);
