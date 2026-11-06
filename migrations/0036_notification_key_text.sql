-- Claves antiguas sin id que terminaban en el hash del texto.
-- No toca una clave nueva recortada: esa mide 113 y el separador va en el carácter 81.
-- Si varias filas caen en la misma clave, se queda la de first_seen_at más antiguo.
-- Las marcas de leído de las que se borran pasan a esa fila.

create table if not exists notification_key_merge (
  creator_id text not null,
  bare text not null,
  keep_key text not null,
  oldest timestamptz not null,
  primary key (creator_id, bare)
);
truncate notification_key_merge;

insert into notification_key_merge (creator_id, bare, keep_key, oldest)
select distinct on (m.creator_id, m.bare)
  m.creator_id,
  m.bare,
  m.notification_key,
  m.first_seen_at
from (
  select n.creator_id, n.notification_key, n.first_seen_at, r.bare
  from of_notification n
  join (
    select creator_id,
           notification_key,
           regexp_replace(notification_key, chr(31) || '[0-9a-f]{32}$', '') as bare
    from of_notification
    where notification_key ~ (chr(31) || '[0-9a-f]{32}$')
      and length(notification_key) - length(replace(notification_key, chr(31), '')) = 5
      and not (
        length(notification_key) = 113
        and substring(notification_key from 81 for 1) = chr(31)
      )
  ) r
    on r.creator_id = n.creator_id
   and (n.notification_key = r.notification_key or n.notification_key = r.bare)
) m
order by m.creator_id, m.bare, m.first_seen_at asc, m.notification_key asc;

insert into of_notification_seen (creator_id, notification_key, user_id, seen_at)
select s.creator_id, k.bare, s.user_id, min(s.seen_at)
from notification_key_merge k
join of_notification n
  on n.creator_id = k.creator_id
 and (
   n.notification_key = k.bare
   or (
     regexp_replace(n.notification_key, chr(31) || '[0-9a-f]{32}$', '') = k.bare
     and n.notification_key ~ (chr(31) || '[0-9a-f]{32}$')
     and length(n.notification_key) - length(replace(n.notification_key, chr(31), '')) = 5
     and not (
       length(n.notification_key) = 113
       and substring(n.notification_key from 81 for 1) = chr(31)
     )
   )
 )
join of_notification_seen s
  on s.creator_id = n.creator_id
 and s.notification_key = n.notification_key
group by s.creator_id, k.bare, s.user_id
on conflict (creator_id, notification_key, user_id) do nothing;

delete from of_notification n
using notification_key_merge k
where n.creator_id = k.creator_id
  and n.notification_key <> k.keep_key
  and (
    n.notification_key = k.bare
    or regexp_replace(n.notification_key, chr(31) || '[0-9a-f]{32}$', '') = k.bare
  );

update of_notification n
set notification_key = k.bare,
    first_seen_at = k.oldest
from notification_key_merge k
where n.creator_id = k.creator_id
  and n.notification_key = k.keep_key;

delete from of_notification_seen s
where s.notification_key ~ (chr(31) || '[0-9a-f]{32}$')
  and length(s.notification_key) - length(replace(s.notification_key, chr(31), '')) = 5
  and not (
    length(s.notification_key) = 113
    and substring(s.notification_key from 81 for 1) = chr(31)
  )
  and not exists (
    select 1 from of_notification n
    where n.creator_id = s.creator_id
      and n.notification_key = s.notification_key
  );

drop table if exists notification_key_merge;
