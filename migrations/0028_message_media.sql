-- La 0022 del hilo puede haber creado las tres primeras. No se cambia el tipo.
alter table of_chat_message add column if not exists media_count integer;
alter table of_chat_message add column if not exists media_seconds integer;
alter table of_chat_message add column if not exists media_preview text;
alter table of_chat_message add column if not exists media_json text;
