create unique index if not exists of_chat_outbound_matched_key
  on of_chat_outbound (creator_id, matched_message_key)
  where matched_message_key is not null;
