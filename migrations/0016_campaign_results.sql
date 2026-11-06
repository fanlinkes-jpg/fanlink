create table if not exists of_campaign_result (
  draft_id text primary key,
  purchases integer,
  revenue_cents integer,
  recorded_at timestamptz not null default now()
);
