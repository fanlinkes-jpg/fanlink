-- Una clave corta para no mandar dos veces el mismo envío.
-- Idempotente. No toca los envíos que ya estaban.

create table if not exists of_chat_send_claim (
  claim_key text primary key,
  outbound_id text not null,
  created_at timestamptz not null default now()
);
