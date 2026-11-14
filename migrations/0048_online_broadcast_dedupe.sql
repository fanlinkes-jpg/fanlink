-- Clave para no repetir el mismo envío a un fan dentro de una ventana deslizante.
-- Idempotente. No borra filas. No es única: la ventana la mira la transacción.

alter table of_chat_outbound add column if not exists dedupe_key text;

create index if not exists of_chat_outbound_online_recent
  on of_chat_outbound (creator_id, fan_key, dedupe_key, created_at desc);
