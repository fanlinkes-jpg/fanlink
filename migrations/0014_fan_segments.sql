alter table of_campaign_draft drop constraint if exists of_campaign_draft_segment_chk;
alter table of_campaign_draft add constraint of_campaign_draft_segment_chk check (
  segment in ('active', 'expired', 'spent', 'quiet', 'whale', 'risk', 'asleep', 'new')
);
