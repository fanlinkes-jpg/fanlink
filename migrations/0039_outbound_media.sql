-- Medios de un borrador. La 0030 antigua ya puede existir: no se recrea
-- y no se tocan las filas que ya había.

create table if not exists of_outbound_media (
  outbound_id text not null,
  creator_id text not null,
  media_id text not null,
  position integer not null default 0,
  primary key (outbound_id, media_id)
);

alter table of_outbound_media add column if not exists creator_id text;
alter table of_outbound_media add column if not exists media_id text;
alter table of_outbound_media add column if not exists position integer;
