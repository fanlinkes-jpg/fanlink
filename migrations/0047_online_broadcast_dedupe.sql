-- Una fila por cuenta, fan y texto dentro de la ventana de 30 minutos.
-- Idempotente. No borra filas.

alter table of_chat_outbound add column if not exists dedupe_key text;

create unique index if not exists of_chat_outbound_online_window
  on of_chat_outbound (creator_id, fan_key, dedupe_key);
