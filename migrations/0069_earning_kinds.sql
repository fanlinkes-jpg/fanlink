-- Los gráficos de ingresos de OnlyFans traen también directos (stream) y referidos (ref).
-- Relaja la restricción de of_earning.kind; no toca datos. Antes de aplicarla, copia data/pglite.
alter table of_earning drop constraint if exists of_earning_kind_chk;
alter table of_earning add constraint of_earning_kind_chk check (kind in ('total', 'subscription', 'tip', 'message', 'post', 'stream', 'referral'));
