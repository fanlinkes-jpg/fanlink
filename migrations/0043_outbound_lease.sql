-- Lease del proceso que está enviando. Idempotente. No borra filas ni tira columnas.
alter table of_chat_outbound add column if not exists claimed_at timestamptz;
alter table of_chat_outbound add column if not exists claim_owner text;
