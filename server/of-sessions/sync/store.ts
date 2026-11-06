import { publicSyncReason } from "../messages.ts";
import type { EarningRow, FanRow, TransactionRow } from "./parse.ts";

export type ReadSql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type StoredEarning = EarningRow & { syncedAt: string };
export type StoredFan = FanRow & { syncedAt: string };
export type StoredTransaction = TransactionRow & { syncedAt: string };

export type StoredCreatorRead = {
  creatorId: string;
  earningsSyncedAt: string | null;
  fansSyncedAt: string | null;
  lastAttemptAt: string | null;
  consecutiveFailures: number;
  lastStatus: "idle" | "ok" | "error";
  lastReason: string | null;
  jsonPaths: string[];
  earnings: StoredEarning[];
  fans: StoredFan[];
  transactions: StoredTransaction[];
  txCursor: string | null;
  txCursorKey: string | null;
};

export function unseenFanKeys(stored: string[], seen: string[], complete: boolean): string[] {
  if (!complete) return [];
  const live = new Set(seen);
  return stored.filter((key) => !live.has(key));
}

/** No caduca a nadie si la lista está cortada o si caerían más del 30 % de los activos. */
export function planFanExpiry(
  activeKeys: string[],
  seen: string[],
  complete: boolean,
): { expire: string[]; warning: string | null } {
  if (!complete) return { expire: [], warning: null };
  const live = new Set(seen);
  const expire = activeKeys.filter((key) => !live.has(key));
  if (activeKeys.length > 0 && expire.length / activeKeys.length > 0.3) {
    return { expire: [], warning: "no se marcan fans expirados: la lectura habría caducado demasiados" };
  }
  return { expire, warning: null };
}

export type SyncMeta = {
  creatorId: string;
  consecutiveFailures: number;
  lastAttemptAt: string | null;
};

const ORIGIN = "onlyfans";

export async function saveCreatorRead(
  sql: ReadSql,
  creatorId: string,
  read: {
    earnings: EarningRow[];
    fans: FanRow[];
    transactions?: TransactionRow[];
    fansComplete?: boolean;
    earningsCaptured: boolean;
    fansCaptured: boolean;
    reason: string | null;
    jsonPaths: string[];
  },
  now = new Date(),
): Promise<void> {
  const syncedAt = now.toISOString();
  let fanWarning: string | null = null;
  await sql.query("begin");
  try {
    if (read.earningsCaptured) {
      await sql.query("delete from of_earning where creator_id = $1", [creatorId]);
      for (const row of read.earnings) {
        await sql.query(
          `insert into of_earning (creator_id, day, kind, amount_cents, currency, synced_at, origin)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [creatorId, row.day, row.kind, row.amountCents, row.currency, syncedAt, ORIGIN],
        );
      }
    }
    if (read.fansCaptured) {
      for (const row of read.fans) {
        await sql.query(
          `insert into of_fan_read (
             creator_id, fan_key, of_user_id, handle, display_name, subscribed_at, status, spent_cents, renew_auto, expires_at, synced_at, origin
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           on conflict (creator_id, fan_key) do update set
             of_user_id = excluded.of_user_id,
             handle = excluded.handle,
             display_name = excluded.display_name,
             subscribed_at = excluded.subscribed_at,
             status = excluded.status,
             spent_cents = excluded.spent_cents,
             renew_auto = excluded.renew_auto,
             expires_at = excluded.expires_at,
             synced_at = excluded.synced_at`,
          [
            creatorId,
            row.fanKey,
            row.ofUserId,
            row.handle,
            row.displayName,
            row.subscribedAt,
            row.status,
            row.spentCents,
            row.renewAuto,
            row.expiresAt,
            syncedAt,
            ORIGIN,
          ],
        );
      }
      if (read.fansComplete) {
        const existing = await sql.query<{ fan_key: string; status: string }>(
          "select fan_key, status from of_fan_read where creator_id = $1",
          [creatorId],
        );
        const active = existing.filter((row) => row.status === "active").map((row) => row.fan_key);
        const decision = planFanExpiry(active, read.fans.map((row) => row.fanKey), true);
        fanWarning = decision.warning;
        if (decision.warning) console.info(`[fanlink:lectura] ${decision.warning}`);
        for (const key of decision.expire) {
          await sql.query(
            "update of_fan_read set status = 'expired', synced_at = $3 where creator_id = $1 and fan_key = $2",
            [creatorId, key, syncedAt],
          );
        }
      }
    }
    for (const row of read.transactions ?? []) {
      await sql.query(
        `insert into of_transaction (
           creator_id, tx_key, occurred_at, gross_cents, net_cents, kind, fan_key, currency, synced_at, origin
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (creator_id, tx_key) do update set
           occurred_at = excluded.occurred_at,
           gross_cents = excluded.gross_cents,
           net_cents = excluded.net_cents,
           kind = excluded.kind,
           fan_key = excluded.fan_key,
           currency = excluded.currency,
           synced_at = excluded.synced_at`,
        [creatorId, row.txKey, row.occurredAt, row.grossCents, row.netCents, row.kind, row.fanKey, row.currency, syncedAt, ORIGIN],
      );
    }
    const previous = await sql.query<{ consecutive_failures: number | string }>(
      "select consecutive_failures from of_sync_state where creator_id = $1",
      [creatorId],
    );
    const failed = Boolean(publicSyncReason(read.reason));
    const failures = failed ? Number(previous[0]?.consecutive_failures ?? 0) + 1 : 0;
    await sql.query(
      `insert into of_sync_state (
         creator_id, earnings_synced_at, fans_synced_at, last_reason, json_paths, origin,
         last_attempt_at, consecutive_failures, last_status
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (creator_id) do update set
         earnings_synced_at = coalesce(excluded.earnings_synced_at, of_sync_state.earnings_synced_at),
         fans_synced_at = coalesce(excluded.fans_synced_at, of_sync_state.fans_synced_at),
         last_reason = excluded.last_reason,
         json_paths = excluded.json_paths,
         origin = excluded.origin,
         last_attempt_at = excluded.last_attempt_at,
         consecutive_failures = excluded.consecutive_failures,
         last_status = excluded.last_status`,
      [
        creatorId,
        read.earningsCaptured ? syncedAt : null,
        read.fansCaptured ? syncedAt : null,
        fanWarning && !failed ? fanWarning : publicSyncReason(read.reason),
        read.jsonPaths.filter((path) => !path.includes("?")).slice(0, 8).join("\n"),
        ORIGIN,
        syncedAt,
        failures,
        failed ? "error" : "ok",
      ],
    );
    const newest = (read.transactions ?? []).reduce<{ at: string; key: string } | null>((max, row) => {
      if (!max || row.occurredAt > max.at || (row.occurredAt === max.at && row.txKey > max.key)) {
        return { at: row.occurredAt, key: row.txKey };
      }
      return max;
    }, null);
    if (newest) {
      await sql.query(
        `update of_sync_state
         set tx_cursor = case
           when tx_cursor is null or tx_cursor < $2::timestamptz then $2::timestamptz
           else tx_cursor
         end,
         tx_cursor_key = case
           when tx_cursor is null or tx_cursor < $2::timestamptz or tx_cursor = $2::timestamptz then $3
           else tx_cursor_key
         end
         where creator_id = $1`,
        [creatorId, newest.at, newest.key],
      );
    }
    await sql.query("commit");
  } catch (error) {
    await sql.query("rollback").catch(() => undefined);
    throw error;
  }
}

export async function listCreatorReads(sql: ReadSql, creatorIds: string[]): Promise<StoredCreatorRead[]> {
  if (!creatorIds.length) return [];
  const filter = creatorIds.map((_, index) => `$${index + 1}`).join(", ");
  const states = await sql.query<StateRow>(
    `select creator_id, earnings_synced_at, fans_synced_at, last_reason, json_paths,
            last_attempt_at, consecutive_failures, last_status
     from of_sync_state where creator_id in (${filter})`,
    creatorIds,
  );
  const earnings = await sql.query<EarningDb>(
    `select creator_id, day::text as day, kind, amount_cents, currency, synced_at
     from of_earning where creator_id in (${filter}) order by day`,
    creatorIds,
  );
  const transactions = await sql.query<TxDb>(
    `select creator_id, tx_key, occurred_at, gross_cents, net_cents, kind, fan_key, currency, synced_at
     from of_transaction where creator_id in (${filter}) order by occurred_at`,
    creatorIds,
  );
  const cursors = await sql.query<{ creator_id: string; tx_cursor: Date | string | null; tx_cursor_key: string | null }>(
    `select creator_id, tx_cursor, tx_cursor_key from of_sync_state where creator_id in (${filter})`,
    creatorIds,
  );
  const fans = await sql.query<FanDb>(
    `select creator_id, fan_key, of_user_id, handle, display_name, subscribed_at, status, spent_cents, renew_auto, expires_at, synced_at
     from of_fan_read where creator_id in (${filter})`,
    creatorIds,
  );
  return states.map((state) => ({
    creatorId: state.creator_id,
    earningsSyncedAt: iso(state.earnings_synced_at),
    fansSyncedAt: iso(state.fans_synced_at),
    lastReason: state.last_reason,
    lastAttemptAt: iso(state.last_attempt_at),
    consecutiveFailures: Number(state.consecutive_failures ?? 0),
    lastStatus: state.last_status === "ok" || state.last_status === "error" ? state.last_status : "idle",
    jsonPaths: (state.json_paths ?? "").split("\n").filter(Boolean),
    earnings: earnings
      .filter((row) => row.creator_id === state.creator_id)
      .map((row) => ({
        day: String(row.day).slice(0, 10),
        kind: row.kind as EarningRow["kind"],
        amountCents: Number(row.amount_cents),
        currency: row.currency,
        syncedAt: iso(row.synced_at) ?? "",
      })),
    fans: fans
      .filter((row) => row.creator_id === state.creator_id)
      .map((row) => ({
        fanKey: row.fan_key,
        ofUserId: row.of_user_id,
        handle: row.handle,
        displayName: row.display_name,
        subscribedAt: iso(row.subscribed_at),
        status: row.status === "expired" ? "expired" : "active",
        spentCents: row.spent_cents == null ? null : Number(row.spent_cents),
        renewAuto: row.renew_auto == null ? null : row.renew_auto === true || row.renew_auto === "t" || row.renew_auto === "true",
        expiresAt: iso(row.expires_at),
        syncedAt: iso(row.synced_at) ?? "",
      })),
    transactions: transactions
      .filter((row) => row.creator_id === state.creator_id)
      .map((row) => ({
        txKey: row.tx_key,
        occurredAt: iso(row.occurred_at) ?? "",
        grossCents: Number(row.gross_cents),
        netCents: row.net_cents == null ? null : Number(row.net_cents),
        kind: row.kind as TransactionRow["kind"],
        fanKey: row.fan_key,
        currency: row.currency,
        syncedAt: iso(row.synced_at) ?? "",
      })),
    txCursor: iso(cursors.find((row) => row.creator_id === state.creator_id)?.tx_cursor ?? null),
    txCursorKey: cursors.find((row) => row.creator_id === state.creator_id)?.tx_cursor_key ?? null,
  }));
}

export async function listSyncMeta(sql: ReadSql): Promise<SyncMeta[]> {
  const rows = await sql.query<{
    creator_id: string;
    consecutive_failures: number | string | null;
    last_attempt_at: Date | string | null;
  }>("select creator_id, consecutive_failures, last_attempt_at from of_sync_state");
  return rows.map((row) => ({
    creatorId: row.creator_id,
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    lastAttemptAt: iso(row.last_attempt_at),
  }));
}

export async function readSyncIntervalMin(sql: ReadSql, fallback: number): Promise<number> {
  const rows = await sql.query<{ interval_min: number | string }>(
    "select interval_min from of_sync_settings where id = 1",
  );
  const saved = rows[0]?.interval_min;
  if (saved == null) return fallback;
  return clampSaved(Number(saved), fallback);
}

export async function readChatIntervalMin(sql: ReadSql, fallback: number): Promise<number> {
  const rows = await sql.query<{ chat_interval_min: number | string | null }>(
    "select chat_interval_min from of_sync_settings where id = 1",
  );
  const saved = rows[0]?.chat_interval_min;
  if (saved == null) return fallback;
  const value = Number(saved);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(30, Math.max(1, Math.round(value)));
}

export async function writeChatIntervalMin(sql: ReadSql, minutes: number): Promise<number> {
  const value = Math.min(30, Math.max(1, Math.round(minutes)));
  const current = await sql.query<{ interval_min: number | string }>(
    "select interval_min from of_sync_settings where id = 1",
  );
  const interval = Number(current[0]?.interval_min ?? 30);
  await sql.query(
    `insert into of_sync_settings (id, interval_min, chat_interval_min) values (1, $1, $2)
     on conflict (id) do update set chat_interval_min = excluded.chat_interval_min`,
    [Number.isFinite(interval) ? interval : 30, value],
  );
  return value;
}

export async function writeSyncIntervalMin(sql: ReadSql, minutes: number): Promise<number> {
  const value = clampSaved(minutes, 30);
  await sql.query(
    `insert into of_sync_settings (id, interval_min) values (1, $1)
     on conflict (id) do update set interval_min = excluded.interval_min`,
    [value],
  );
  return value;
}

function clampSaved(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1440, Math.max(5, Math.round(value)));
}

type StateRow = {
  creator_id: string;
  earnings_synced_at: Date | string | null;
  fans_synced_at: Date | string | null;
  last_reason: string | null;
  json_paths: string | null;
  last_attempt_at: Date | string | null;
  consecutive_failures: number | string | null;
  last_status: string | null;
};

type EarningDb = {
  creator_id: string;
  day: string;
  kind: string;
  amount_cents: number | string;
  currency: string;
  synced_at: Date | string;
};

type FanDb = {
  creator_id: string;
  fan_key: string;
  of_user_id: string | null;
  handle: string | null;
  display_name: string | null;
  subscribed_at: Date | string | null;
  status: string;
  spent_cents: number | string | null;
  renew_auto: boolean | string | null;
  expires_at: Date | string | null;
  synced_at: Date | string;
};

type TxDb = {
  creator_id: string;
  tx_key: string;
  occurred_at: Date | string;
  gross_cents: number | string;
  net_cents: number | string | null;
  kind: string;
  fan_key: string | null;
  currency: string;
  synced_at: Date | string;
};

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString();
}

