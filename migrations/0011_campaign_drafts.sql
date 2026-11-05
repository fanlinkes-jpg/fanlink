create table if not exists of_campaign_draft (
  id text primary key,
  creator_id text not null,
  name text not null,
  segment text not null,
  body text not null,
  price_cents integer,
  vault_ids text not null default '',
  scheduled_at timestamptz,
  recipient_count integer not null default 0,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  constraint of_campaign_draft_segment_chk check (segment in ('active', 'expired', 'spent', 'quiet')),
  constraint of_campaign_draft_status_chk check (status in ('draft', 'scheduled'))
);
