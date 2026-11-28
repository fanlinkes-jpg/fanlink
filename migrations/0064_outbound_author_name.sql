-- Borrar a un empleado no borra sus envíos. El autor queda en null y el nombre que tenía al enviar se conserva.
alter table of_chat_outbound add column if not exists author_name text;
alter table of_chat_message add column if not exists author_name text;

alter table of_chat_outbound alter column author_id drop not null;
alter table of_chat_outbound drop constraint if exists of_chat_outbound_author_id_fkey;
alter table of_chat_outbound
  add constraint of_chat_outbound_author_id_fkey
  foreign key (author_id) references staff_profile (user_id) on delete set null;

update of_chat_outbound o
set author_name = p.display_name
from staff_profile p
where p.user_id = o.author_id and o.author_name is null;

update of_chat_message m
set author_name = p.display_name
from staff_profile p
where p.user_id = m.author_id and m.author_name is null;

-- Desde ahora cada envío guarda el nombre del autor al escribirse, sin tocar las consultas de envío.
create or replace function fanlink_outbound_author_name() returns trigger as $$
begin
  if new.author_id is not null and new.author_name is null then
    select display_name into new.author_name from staff_profile where user_id = new.author_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists of_chat_outbound_author_name on of_chat_outbound;
create trigger of_chat_outbound_author_name
  before insert or update of author_id on of_chat_outbound
  for each row execute function fanlink_outbound_author_name();

-- El mensaje recibe el nombre cuando se le asigna el autor. Si el autor se borra (author_id pasa a null) se queda el nombre.
create or replace function fanlink_message_author_name() returns trigger as $$
begin
  if new.author_id is not null and (new.author_name is null or new.author_id is distinct from old.author_id) then
    select display_name into new.author_name from staff_profile where user_id = new.author_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists of_chat_message_author_name on of_chat_message;
create trigger of_chat_message_author_name
  before update of author_id on of_chat_message
  for each row execute function fanlink_message_author_name();
