-- Contadores reales de cada lista y las listas a las que pertenece un medio.
-- Idempotente. No borra filas.

alter table of_vault_list add column if not exists photos_count integer;
alter table of_vault_list add column if not exists videos_count integer;
alter table of_vault_list add column if not exists gifs_count integer;
alter table of_vault_list add column if not exists audios_count integer;

alter table of_vault_item add column if not exists list_ids jsonb;
