create table if not exists of_mass_message (
  id text primary key,
  creator_id text not null,
  idempotency_key text not null,
  name text not null,
  body text not null,
  body_json text not null,
  price_cents integer,
  vault_ids jsonb not null default '[]',
  preview_vault_ids jsonb not null default '[]',
  scheduled_at timestamptz,
  segment_json text not null,
  unsend_after_hours integer,
  follow_up_json text,
  follow_up_after_hours integer,
  created_by_id text,
  created_by_name text,
  rotate boolean not null default false,
  exclude_bought boolean not null default false,
  status text not null default 'draft',
  flag text,
  created_at timestamptz not null default now(),
  constraint of_mass_message_idem_uniq unique (creator_id, idempotency_key),
  constraint of_mass_message_status_chk check (status in ('draft', 'scheduled', 'held', 'cancelled', 'sent', 'retry')),
  constraint of_mass_message_price_chk check (
    price_cents is null or (price_cents >= 300 and price_cents <= 20000 and mod(price_cents, 100) = 0)
  ),
  constraint of_mass_message_unsend_chk check (
    unsend_after_hours is null or (unsend_after_hours >= 1 and unsend_after_hours <= 168)
  )
);

create index if not exists of_mass_message_creator_idx on of_mass_message (creator_id);
