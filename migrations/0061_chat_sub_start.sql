alter table of_chat_thread add column if not exists sub_started_at timestamptz;
alter table of_chat_thread add column if not exists sub_months integer;
