-- Clip corto de videoSources, si OnlyFans lo manda. Idempotente. No borra filas.

alter table of_vault_item add column if not exists clip_url text;
