-- Contadores de no leídas que devuelve OnlyFans, y si cada aviso sigue sin leer allí.
alter table of_notification_sync add column if not exists unread_counts jsonb;
alter table of_notification_sync add column if not exists last_http_status integer;
alter table of_notification add column if not exists of_unread boolean;
