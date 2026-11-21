-- Pertenencia de un medio a una lista, la que devuelve el recorrido con list_id.
-- Idempotente. No borra filas.

create table if not exists of_vault_list_item (
  creator_id text not null,
  list_key text not null,
  item_key text not null,
  primary key (creator_id, list_key, item_key)
);
