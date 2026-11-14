-- Datos de la ficha que OnlyFans manda en el usuario de la notificación.
-- Null significa que esa respuesta no traía el campo.
alter table of_notification add column if not exists fan_handle text;
alter table of_notification add column if not exists avatar_url text;
alter table of_notification add column if not exists fan_lists text;
alter table of_notification add column if not exists renew_auto boolean;
alter table of_notification add column if not exists fan_seen_at timestamptz;
alter table of_notification add column if not exists post_ref text;
alter table of_notification add column if not exists post_link text;
alter table of_notification add column if not exists post_text text;
