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
  idempotency_key: string;
  vault_ids: unknown;
  preview_vault_ids: unknown;
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

/** Guarda el borrador. La misma clave de la cuenta no crea otra fila. No envía. */
export async function saveMassDraft(
  sql: ReadSql,
  draft: MassDraft,
): Promise<MassDraft> {
  const preview = draft.media
    .filter((item) => item.preview)
    .map((item) => item.vaultId);
  await sql.query(
    `insert into of_mass_message (
       id, creator_id, idempotency_key, name, body, body_json, price_cents, vault_ids, preview_vault_ids, scheduled_at,
       segment_json, unsend_after_hours, follow_up_json, follow_up_after_hours, created_by_id, created_by_name,
       rotate, exclude_bought, status, flag
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10,
       $11, $12, $13, $14, $15, $16,
       $17, $18, $19, $20
     )
     on conflict (creator_id, idempotency_key) do nothing`,
    [
      draft.id,
      draft.accountId,
      draft.idempotencyKey,
      draft.name,
      runsText(draft.body),
      JSON.stringify(draft.body),
      draft.priceCents,
      JSON.stringify(draft.media.map((item) => item.vaultId)),
      JSON.stringify(preview),
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
  const stored = await readMassDraftByKey(
    sql,
    draft.accountId,
    draft.idempotencyKey,
  );
  if (!stored) throw new Error("No se ha podido guardar el masivo.");
  return stored;
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
  return row ? rowToDraft(row) : null;
}

async function readMassDraftByKey(
  sql: ReadSql,
  accountId: string,
  idempotencyKey: string,
): Promise<MassDraft | null> {
  const rows = await sql.query<MassRow>(
    "select * from of_mass_message where creator_id = $1 and idempotency_key = $2",
    [accountId, idempotencyKey],
  );
  const row = rows[0];
  return row ? rowToDraft(row) : null;
}

function rowToDraft(row: MassRow): MassDraft {
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
    idempotencyKey: row.idempotency_key,
    flag: row.flag ?? undefined,
  };
}

function mediaFrom(vaultIds: unknown, previewIds: unknown): MassMedia[] {
  const preview = new Set(asIds(previewIds));
  return asIds(vaultIds).map((vaultId) => ({
    vaultId,
    preview: preview.has(vaultId),
  }));
}

function asIds(value: unknown): string[] {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
    case "cancelled":
    case "sent":
    case "retry":
      return value;
    default:
      throw new Error("El borrador guardado no se puede leer.");
  }
}
