alter table of_chat_thread add column avatar_url text;
alter table of_chat_thread add column is_online boolean;
alter table of_chat_thread add column sub_price_cents integer;
alter table of_chat_thread add column sub_expires_at timestamptz;
alter table of_chat_thread add column renew_auto boolean;
alter table of_chat_message add column seen boolean;
alter table of_chat_message add column automatic boolean;
