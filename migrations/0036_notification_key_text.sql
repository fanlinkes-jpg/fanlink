-- Claves sin id que llevaban el hash del texto: se quedan en fecha, tipo, fan e hilo.
-- Si dos filas caen en la misma clave, se conserva una y se borra el duplicado.
-- Volver a aplicar no encuentra ya ese sufijo. chr(31) es el separador de la clave.

delete from of_notification_seen s
using of_notification n
where s.creator_id = n.creator_id
  and s.notification_key = n.notification_key
  and n.notification_key ~ (chr(31) || '[0-9a-f]{32}$')
  and length(n.notification_key) - length(replace(n.notification_key, chr(31), '')) = 5
  and (
    exists (
      select 1 from of_notification o
      where o.creator_id = n.creator_id
        and o.notification_key = regexp_replace(n.notification_key, chr(31) || '[0-9a-f]{32}$', '')
        and o.notification_key <> n.notification_key
    )
    or exists (
      select 1 from of_notification n2
      where n2.creator_id = n.creator_id
        and n2.notification_key <> n.notification_key
        and n2.notification_key ~ (chr(31) || '[0-9a-f]{32}$')
        and length(n2.notification_key) - length(replace(n2.notification_key, chr(31), '')) = 5
        and regexp_replace(n2.notification_key, chr(31) || '[0-9a-f]{32}$', '') = regexp_replace(n.notification_key, chr(31) || '[0-9a-f]{32}$', '')
        and n2.notification_key < n.notification_key
    )
  );

delete from of_notification n
where n.notification_key ~ (chr(31) || '[0-9a-f]{32}$')
  and length(n.notification_key) - length(replace(n.notification_key, chr(31), '')) = 5
  and (
    exists (
      select 1 from of_notification o
      where o.creator_id = n.creator_id
        and o.notification_key = regexp_replace(n.notification_key, chr(31) || '[0-9a-f]{32}$', '')
        and o.notification_key <> n.notification_key
    )
    or exists (
      select 1 from of_notification n2
      where n2.creator_id = n.creator_id
        and n2.notification_key <> n.notification_key
        and n2.notification_key ~ (chr(31) || '[0-9a-f]{32}$')
        and length(n2.notification_key) - length(replace(n2.notification_key, chr(31), '')) = 5
        and regexp_replace(n2.notification_key, chr(31) || '[0-9a-f]{32}$', '') = regexp_replace(n.notification_key, chr(31) || '[0-9a-f]{32}$', '')
        and n2.notification_key < n.notification_key
    )
  );

update of_notification
set notification_key = regexp_replace(notification_key, chr(31) || '[0-9a-f]{32}$', '')
where notification_key ~ (chr(31) || '[0-9a-f]{32}$')
  and length(notification_key) - length(replace(notification_key, chr(31), '')) = 5;

delete from of_notification_seen s
where s.notification_key ~ (chr(31) || '[0-9a-f]{32}$')
  and length(s.notification_key) - length(replace(s.notification_key, chr(31), '')) = 5
  and exists (
    select 1 from of_notification_seen o
    where o.creator_id = s.creator_id
      and o.user_id = s.user_id
      and o.notification_key = regexp_replace(s.notification_key, chr(31) || '[0-9a-f]{32}$', '')
  );

update of_notification_seen
set notification_key = regexp_replace(notification_key, chr(31) || '[0-9a-f]{32}$', '')
where notification_key ~ (chr(31) || '[0-9a-f]{32}$')
  and length(notification_key) - length(replace(notification_key, chr(31), '')) = 5;
