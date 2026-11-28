-- Dashboard (CDF-20): cifras sueltas leídas de OnlyFans en cada corte (00:00, 08:00 y 16:00 Europe/Madrid)
-- y registro de los cortes. Solo añade tablas: no toca datos existentes.
create table if not exists of_dashboard_snapshot (
  creator_id text not null,
  metric text not null,
  taken_at timestamptz not null,
  value integer not null,
  origin text not null default 'onlyfans',
  primary key (creator_id, metric, taken_at),
  constraint of_dashboard_snapshot_metric_chk check (metric in ('online', 'profile_visitors', 'link_clicks', 'of_ranking', 'following')),
  constraint of_dashboard_snapshot_origin_chk check (origin = 'onlyfans')
);
create index if not exists of_dashboard_snapshot_taken_idx on of_dashboard_snapshot (metric, taken_at);

create table if not exists of_dashboard_cut (
  cut_at timestamptz primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  accounts_read integer not null default 0
);
