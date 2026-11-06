create table if not exists of_outbound_media (
  outbound_id text not null references of_chat_outbound (id) on delete cascade,
  creator_id text not null,
  media_id text not null,
  position integer not null,
  primary key (outbound_id, media_id)
);
