-- Bases que ya aplicaron las notificaciones sin first_seen_at.
-- synced_at es la última vez que se vio el aviso, no la primera.
alter table of_notification add column if not exists first_seen_at timestamptz;
update of_notification set first_seen_at = coalesce(first_seen_at, synced_at, now()) where first_seen_at is null;
alter table of_notification alter column first_seen_at set default now();
alter table of_notification alter column first_seen_at set not null;
