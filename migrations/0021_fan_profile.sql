alter table of_chat_thread add column fan_lists text;

create table if not exists of_fan_profile (
  creator_id text not null,
  fan_key text not null,
  nickname text,
  birthday date,
  timezone text,
  source text,
  salary_cents integer,
  last_pay_date date,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (creator_id, fan_key)
);
