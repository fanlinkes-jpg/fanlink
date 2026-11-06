alter table of_outbound_media add column if not exists creator_id text;

-- Una 0030 vieja deja creator_id vacío. Se copia del borrador antes de borrar huérfanos.
update of_outbound_media as media
set creator_id = outbound.creator_id
from of_chat_outbound as outbound
where media.outbound_id = outbound.id
  and (media.creator_id is null or media.creator_id = '');

delete from of_outbound_media
where creator_id is null
   or creator_id = ''
   or outbound_id not in (select id from of_chat_outbound);

alter table of_outbound_media alter column creator_id set not null;

alter table of_outbound_media drop constraint if exists of_outbound_media_outbound_id_fkey;

alter table of_outbound_media
  add constraint of_outbound_media_outbound_id_fkey
  foreign key (outbound_id) references of_chat_outbound (id) on delete cascade;
