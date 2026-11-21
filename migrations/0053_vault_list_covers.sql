-- Portadas de cada lista (id y tipo). Sin URL. Idempotente. No borra filas.

alter table of_vault_list add column if not exists cover_ids jsonb;
