alter table of_chat_thread add column if not exists history_cursor text;
alter table of_chat_thread add column if not exists history_done boolean not null default false;

alter table of_sync_state add column if not exists chat_list_cursor text;
alter table of_sync_state add column if not exists chat_list_done boolean not null default false;

alter table of_chat_message add column if not exists media_json text;
alter table of_chat_message add column if not exists liked boolean;
alter table of_chat_message add column if not exists reply_body text;
alter table of_chat_message add column if not exists event_kind text;
alter table of_chat_message add column if not exists event_cents integer;
