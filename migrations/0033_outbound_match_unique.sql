-- Un mismo mensaje pudo casarse con varios borradores. Se queda el de menor
-- diferencia con sent_at; si el mensaje no está, el más antiguo. El mensaje
-- se queda con el autor de ese borrador. Luego el índice.
with ranked as (
  select o.id,
         o.creator_id,
         o.author_id,
         o.matched_message_key,
         row_number() over (
           partition by o.creator_id, o.matched_message_key
           order by
             case
               when m.sent_at is null then null
               else abs(extract(epoch from o.created_at) - extract(epoch from m.sent_at))
             end asc nulls last,
             o.created_at asc,
             o.id asc
         ) as n
  from of_chat_outbound o
  left join of_chat_message m
    on m.creator_id = o.creator_id
   and m.message_key = o.matched_message_key
  where o.matched_message_key is not null
),
dropped as (
  update of_chat_outbound as target
  set matched_message_key = null
  from ranked
  where target.id = ranked.id
    and ranked.n > 1
  returning ranked.creator_id, ranked.matched_message_key, ranked.author_id
)
update of_chat_message as message
set author_id = kept.author_id
from dropped
join ranked as kept
  on kept.n = 1
 and kept.creator_id = dropped.creator_id
 and kept.matched_message_key = dropped.matched_message_key
where message.creator_id = dropped.creator_id
  and message.message_key = dropped.matched_message_key;

create unique index if not exists of_chat_outbound_matched_key
  on of_chat_outbound (creator_id, matched_message_key)
  where matched_message_key is not null;
