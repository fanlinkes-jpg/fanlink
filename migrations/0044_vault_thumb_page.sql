-- Página de vault/media de la que salió cada miniatura.
-- Idempotente. No borra filas.

alter table of_vault_item add column if not exists thumb_list text;
alter table of_vault_item add column if not exists thumb_offset integer;
