import type { ReadSql } from "./store.ts";

export type FanProfile = {
  creatorId: string;
  fanKey: string;
  nickname: string | null;
  birthday: string | null;
  timezone: string | null;
  source: string | null;
  salaryCents: number | null;
  lastPayDate: string | null;
};

type ProfileRow = {
  creator_id: string;
  fan_key: string;
  nickname: string | null;
  birthday: Date | string | null;
  timezone: string | null;
  source: string | null;
  salary_cents: number | string | null;
  last_pay_date: Date | string | null;
};

export async function listFanProfiles(sql: ReadSql, creatorIds: string[]): Promise<FanProfile[]> {
  if (!creatorIds.length) return [];
  const filter = creatorIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await sql.query<ProfileRow>(
    `select creator_id, fan_key, nickname, birthday, timezone, source, salary_cents, last_pay_date
     from of_fan_profile where creator_id in (${filter})`,
    creatorIds,
  );
  return rows.map(toProfile);
}

export async function saveFanProfile(
  sql: ReadSql,
  profile: FanProfile & { updatedBy: string },
): Promise<void> {
  await sql.query(
    `insert into of_fan_profile (
       creator_id, fan_key, nickname, birthday, timezone, source, salary_cents, last_pay_date, updated_by, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (creator_id, fan_key) do update set
       nickname = excluded.nickname,
       birthday = excluded.birthday,
       timezone = excluded.timezone,
       source = excluded.source,
       salary_cents = excluded.salary_cents,
       last_pay_date = excluded.last_pay_date,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [
      profile.creatorId,
      profile.fanKey,
      blank(profile.nickname),
      blank(profile.birthday),
      blank(profile.timezone),
      blank(profile.source),
      profile.salaryCents,
      blank(profile.lastPayDate),
      profile.updatedBy,
    ],
  );
}

function toProfile(row: ProfileRow): FanProfile {
  return {
    creatorId: row.creator_id,
    fanKey: row.fan_key,
    nickname: row.nickname,
    birthday: day(row.birthday),
    timezone: row.timezone,
    source: row.source,
    salaryCents: row.salary_cents == null ? null : Number(row.salary_cents),
    lastPayDate: day(row.last_pay_date),
  };
}

function day(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function blank(value: string | null): string | null {
  const text = value?.trim() ?? "";
  return text ? text : null;
}
