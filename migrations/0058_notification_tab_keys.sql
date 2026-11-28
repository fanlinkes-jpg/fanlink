-- La misma aviso se guardaba una vez por pestaña, con la clave terminada
-- en el separador y el type. Se queda la fila base. Idempotente.
alter table of_notification add column if not exists message_ref text;

do $$
declare
  suffix text;
begin
  foreach suffix in array array[
    'subscribed', 'tip', 'favorited', 'commented', 'mentioned', 'message',
    'deactivated_media', 'compra', 'tags', 'onlyfans', 'promotions', 'purchases'
  ]
  loop
    execute format($q$
      update of_notification as base
      set
        body = coalesce(base.body, dup.body),
        fan_key = coalesce(base.fan_key, dup.fan_key),
        fan_name = coalesce(base.fan_name, dup.fan_name),
        thread_key = coalesce(base.thread_key, dup.thread_key),
        amount_cents = coalesce(base.amount_cents, dup.amount_cents),
        occurred_at = coalesce(base.occurred_at, dup.occurred_at),
        of_type = coalesce(base.of_type, dup.of_type),
        message_ref = coalesce(base.message_ref, dup.message_ref),
        fan_handle = coalesce(base.fan_handle, dup.fan_handle),
        avatar_url = coalesce(base.avatar_url, dup.avatar_url),
        fan_lists = coalesce(base.fan_lists, dup.fan_lists),
        renew_auto = coalesce(base.renew_auto, dup.renew_auto),
        fan_seen_at = coalesce(base.fan_seen_at, dup.fan_seen_at),
        post_ref = coalesce(base.post_ref, dup.post_ref),
        post_link = coalesce(base.post_link, dup.post_link),
        post_text = coalesce(base.post_text, dup.post_text)
      from of_notification as dup
      where dup.creator_id = base.creator_id
        and dup.notification_key = base.notification_key || E'\x1f' || %L
    $q$, suffix);

    execute format($q$
      update of_notification_seen as seen
      set notification_key = regexp_replace(seen.notification_key, E'\\x1f' || %L || '$', '')
      where seen.notification_key like '%%' || E'\x1f' || %L
        and exists (
          select 1 from of_notification as base
          where base.creator_id = seen.creator_id
            and base.notification_key = regexp_replace(seen.notification_key, E'\\x1f' || %L || '$', '')
        )
        and not exists (
          select 1 from of_notification_seen as other
          where other.creator_id = seen.creator_id
            and other.user_id = seen.user_id
            and other.notification_key = regexp_replace(seen.notification_key, E'\\x1f' || %L || '$', '')
        )
    $q$, suffix, suffix, suffix, suffix);

    execute format($q$
      delete from of_notification_seen as seen
      where seen.notification_key like '%%' || E'\x1f' || %L
        and exists (
          select 1 from of_notification_seen as other
          where other.creator_id = seen.creator_id
            and other.user_id = seen.user_id
            and other.notification_key = regexp_replace(seen.notification_key, E'\\x1f' || %L || '$', '')
        )
    $q$, suffix, suffix);

    execute format($q$
      delete from of_notification as dup
      using of_notification as base
      where dup.creator_id = base.creator_id
        and dup.notification_key = base.notification_key || E'\x1f' || %L
    $q$, suffix);

    execute format($q$
      update of_notification
      set
        notification_key = regexp_replace(notification_key, E'\\x1f' || %L || '$', ''),
        of_type = coalesce(of_type, %L)
      where notification_key like '%%' || E'\x1f' || %L
    $q$, suffix, suffix, suffix);
  end loop;
end $$;
