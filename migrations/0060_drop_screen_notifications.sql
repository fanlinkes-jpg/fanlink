-- Avisos viejos leídos de la pantalla (10/11), clave «pantalla:…».
-- No toca las filas que vienen de api2. Idempotente.

delete from of_notification_seen
where notification_key like 'pantalla:%';

delete from of_notification
where notification_key like 'pantalla:%';
