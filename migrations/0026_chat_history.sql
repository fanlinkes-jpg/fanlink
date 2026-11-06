alter table of_chat_thread add column history_cursor text;
alter table of_chat_thread add column history_done boolean not null default false;

alter table of_sync_state add column chat_list_cursor text;
alter table of_sync_state add column chat_list_done boolean not null default false;

alter table of_chat_message add column media_json text;
alter table of_chat_message add column liked boolean;
alter table of_chat_message add column reply_body text;
alter table of_chat_message add column event_kind text;
alter table of_chat_message add column event_cents integer;
