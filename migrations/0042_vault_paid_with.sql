-- El tráiler señala el id del vídeo de pago. Idempotente. No borra filas.

alter table of_vault_item add column if not exists paid_with_id text;
