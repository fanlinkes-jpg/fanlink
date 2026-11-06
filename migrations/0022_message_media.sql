alter table of_chat_message add column if not exists media_count integer;
alter table of_chat_message add column if not exists media_seconds integer;
alter table of_chat_message add column if not exists media_preview text;
alter table of_chat_message add column if not exists media_json text;
