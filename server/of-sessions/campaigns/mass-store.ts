import { knownMark } from "../../../src/lib/mass/text.ts";
import type {
  MassDraft,
  MassMedia,
  TextMark,
  TextRun,
} from "../../../src/lib/mass/types.ts";
import type { ReadSql } from "../sync/store.ts";

type MassRow = {
  id: string;
  creator_id: string;
  name: string;
  body_json: string;
  price_cents: number | null;
  vault_ids: string;
  preview_vault_ids: string;
  scheduled_at: Date | string | null;
  segment_json: string;
  unsend_after_hours: number | null;
  follow_up_json: string | null;
  follow_up_after_hours: number | null;
  created_by_id: string | null;
  created_by_name: string | null;
  rotate: boolean | string;
  exclude_bought: boolean | string;
  status: string;
  flag: string | null;
};

/** Guarda el borrador. No envía. */
export async function saveMassDraft(
  sql: ReadSql,
  draft: MassDraft,
): Promise<void> {
  const preview = draft.media
    .filter((item) => item.preview)
    .map((item) => item.vaultId);
  await sql.query(
    `insert into of_mass_message (
       id, creator_id, name, body, body_json, price_cents, vault_ids, preview_vault_ids, scheduled_at,
       segment_json, unsend_after_hours, follow_up_json, follow_up_after_hours, created_by_id, created_by_name,
       rotate, exclude_bought, status, flag
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19
     )`,
    [
      draft.id,
      draft.accountId,
      draft.name,
      runsText(draft.body),
      JSON.stringify(draft.body),
      draft.priceCents,
      draft.media.map((item) => item.vaultId).join(","),
      preview.join(","),
      draft.scheduledAt,
      JSON.stringify(draft.segment),
      draft.unsendAfterHours,
      draft.followUp ? JSON.stringify(draft.followUp.body) : null,
      draft.followUp?.afterHours ?? null,
      draft.createdBy?.id ?? null,
      draft.createdBy?.name ?? null,
      draft.rotate,
      draft.excludeBought,
      draft.status,
      draft.flag ?? null,
    ],
  );
}

export async function readMassDraft(
  sql: ReadSql,
  id: string,
): Promise<MassDraft | null> {
  const rows = await sql.query<MassRow>(
    "select * from of_mass_message where id = $1",
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.creator_id,
    name: row.name,
    body: parseRuns(row.body_json),
    media: mediaFrom(row.vault_ids, row.preview_vault_ids),
    priceCents: row.price_cents == null ? null : Number(row.price_cents),
    scheduledAt: iso(row.scheduled_at),
    segment: JSON.parse(row.segment_json) as MassDraft["segment"],
    unsendAfterHours:
      row.unsend_after_hours == null ? null : Number(row.unsend_after_hours),
    followUp:
      row.follow_up_json == null || row.follow_up_after_hours == null
        ? null
        : {
            body: parseRuns(row.follow_up_json),
            afterHours: Number(row.follow_up_after_hours),
          },
    createdBy:
      row.created_by_id && row.created_by_name
        ? { id: row.created_by_id, name: row.created_by_name }
        : null,
    rotate: flag(row.rotate),
    excludeBought: flag(row.exclude_bought),
    status: statusOf(row.status),
    flag: row.flag ?? undefined,
  };
}

function mediaFrom(vaultIds: string, previewIds: string): MassMedia[] {
  const preview = new Set(splitIds(previewIds));
  return splitIds(vaultIds).map((vaultId) => ({
    vaultId,
    preview: preview.has(vaultId),
  }));
}

function splitIds(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRuns(value: string): TextRun[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed))
    throw new Error("El borrador guardado no se puede leer.");
  return parsed.map((run) => {
    if (run == null || typeof run !== "object" || !("text" in run)) {
      throw new Error("El borrador guardado no se puede leer.");
    }
    const record = run as { text: unknown; marks?: unknown };
    if (typeof record.text !== "string")
      throw new Error("El borrador guardado no se puede leer.");
    const marks = Array.isArray(record.marks)
      ? record.marks.filter(
          (mark): mark is TextMark =>
            typeof mark === "string" && knownMark(mark),
        )
      : undefined;
    return {
      text: record.text,
      marks: marks && marks.length > 0 ? marks : undefined,
    };
  });
}

function runsText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join("");
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function flag(value: boolean | string): boolean {
  return value === true || value === "t" || value === "true";
}

function statusOf(value: string): MassDraft["status"] {
  switch (value) {
    case "draft":
    case "scheduled":
    case "held":
      return value;
    default:
      throw new Error("El borrador guardado no se puede leer.");
  }
}
