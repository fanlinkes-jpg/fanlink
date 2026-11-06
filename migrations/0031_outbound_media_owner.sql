alter table of_outbound_media add column if not exists creator_id text;

delete from of_outbound_media
where creator_id is null
   or outbound_id not in (select id from of_chat_outbound);

alter table of_outbound_media alter column creator_id set not null;

alter table of_outbound_media drop constraint if exists of_outbound_media_outbound_id_fkey;

alter table of_outbound_media
  add constraint of_outbound_media_outbound_id_fkey
  foreign key (outbound_id) references of_chat_outbound (id) on delete cascade;
