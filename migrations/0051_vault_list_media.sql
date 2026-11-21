-- Si la lista no tiene medios, y la miniatura distinta del preview.
-- Idempotente. No borra filas.

alter table of_vault_list add column if not exists has_media boolean;
alter table of_vault_item add column if not exists thumb_url text;
