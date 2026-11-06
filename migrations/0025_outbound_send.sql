alter table of_chat_outbound add column status text not null default 'pending';
alter table of_chat_outbound add column error_reason text;
alter table of_chat_outbound add column sent_at timestamptz;
