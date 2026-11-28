-- Atribución de ventas persistida. Una fila por venta; se escribe una vez y no se reasigna a otra persona.
--   sender: un PPV es de quien envió el mensaje.
--   mass: un masivo es de quien lo lanzó.
--   last_chatter: propinas y suscripciones son del último chatter que habló con el fan.
-- `chatter_id` no lleva clave foránea: si borran al empleado, la venta conserva su nombre.
create table if not exists of_sale_attribution (
  sale_key text primary key,
  creator_id text not null,
  fan_key text,
  kind text not null,
  sold_at timestamptz not null,
  gross_cents integer not null,
  chatter_id text,
  chatter_name text,
  rule text not null,
  attributed_at timestamptz not null default now(),
  constraint of_sale_attribution_kind_chk check (kind in ('ppv', 'mass', 'tip', 'subscription', 'renewal', 'message', 'post', 'stream', 'referral')),
  constraint of_sale_attribution_rule_chk check (rule in ('sender', 'mass', 'last_chatter', 'none'))
);
create index if not exists of_sale_attribution_chatter_idx on of_sale_attribution (chatter_id);
create index if not exists of_sale_attribution_creator_idx on of_sale_attribution (creator_id, sold_at);

-- Un mensaje enviado desde un masivo apunta a él: así la venta va al que lo lanzó.
do $$
begin
  if to_regclass('of_chat_message') is not null then
    alter table of_chat_message add column if not exists mass_id text;
  end if;
end $$;
