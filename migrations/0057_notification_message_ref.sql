alter table of_notification add column if not exists message_ref text;

-- La misma compra se guardaba dos veces: una con of_type nulo y otra con
-- la clave terminada en el separador y «purchases». Se queda una fila.
update of_notification as base
set
  body = coalesce(base.body, dup.body),
  fan_key = coalesce(base.fan_key, dup.fan_key),
  fan_name = coalesce(base.fan_name, dup.fan_name),
  thread_key = coalesce(base.thread_key, dup.thread_key),
  amount_cents = coalesce(base.amount_cents, dup.amount_cents),
  occurred_at = coalesce(base.occurred_at, dup.occurred_at),
  of_type = coalesce(base.of_type, dup.of_type),
  message_ref = coalesce(base.message_ref, dup.message_ref)
from of_notification as dup
where dup.creator_id = base.creator_id
  and dup.notification_key = base.notification_key || E'\x1fpurchases';

update of_notification_seen as seen
set notification_key = regexp_replace(seen.notification_key, E'\\x1fpurchases$', '')
where seen.notification_key like '%' || E'\x1fpurchases'
  and exists (
    select 1 from of_notification as base
    where base.creator_id = seen.creator_id
      and base.notification_key = regexp_replace(seen.notification_key, E'\\x1fpurchases$', '')
  )
  and not exists (
    select 1 from of_notification_seen as other
    where other.creator_id = seen.creator_id
      and other.user_id = seen.user_id
      and other.notification_key = regexp_replace(seen.notification_key, E'\\x1fpurchases$', '')
  );

delete from of_notification_seen as seen
where seen.notification_key like '%' || E'\x1fpurchases'
  and exists (
    select 1 from of_notification_seen as other
    where other.creator_id = seen.creator_id
      and other.user_id = seen.user_id
      and other.notification_key = regexp_replace(seen.notification_key, E'\\x1fpurchases$', '')
  );

delete from of_notification as dup
using of_notification as base
where dup.creator_id = base.creator_id
  and dup.notification_key = base.notification_key || E'\x1fpurchases';

update of_notification
set
  notification_key = regexp_replace(notification_key, E'\\x1fpurchases$', ''),
  of_type = coalesce(of_type, 'purchases')
where notification_key like '%' || E'\x1fpurchases';
