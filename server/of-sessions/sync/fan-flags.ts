import type { ReadSql } from "./store.ts";

/** Marcas del CRM por fan. Se guardan en la base y las ve todo el equipo. No tocan OnlyFans. */
export type FanFlag = { creatorId: string; fanKey: string; favorite: boolean; muted: boolean; pinnedAt: string | null };

export type FanFlagPatch = { favorite?: boolean; muted?: boolean; pinned?: boolean };

type FlagRow = {
  creator_id: string;
  fan_key: string;
  favorite: boolean | string;
  muted: boolean | string;
  pinned_at: Date | string | null;
};

const yes = (value: boolean | string) => value === true || value === "t" || value === "true";

export async function listFanFlags(sql: ReadSql, creatorIds: string[]): Promise<FanFlag[]> {
  if (!creatorIds.length) return [];
  const filter = creatorIds.map((_, index) => `$${index + 1}`).join(", ");
  try {
    const rows = await sql.query<FlagRow>(
      `select creator_id, fan_key, favorite, muted, pinned_at from of_fan_flag
       where creator_id in (${filter}) and (favorite or muted or pinned_at is not null)`,
      creatorIds,
    );
    return rows.map((row) => ({
      creatorId: row.creator_id,
      fanKey: row.fan_key,
      favorite: yes(row.favorite),
      muted: yes(row.muted),
      pinnedAt: row.pinned_at == null ? null : new Date(row.pinned_at).toISOString(),
    }));
  } catch {
    // Base sin la migración 0062: la lista de chats sigue funcionando.
    return [];
  }
}

/** Solo cambia lo que viene en el parche. Fijar pone la hora; desfijar la borra. */
export async function saveFanFlag(
  sql: ReadSql,
  input: { creatorId: string; fanKey: string; patch: FanFlagPatch; updatedBy: string },
): Promise<FanFlag> {
  const { patch } = input;
  const pinned = patch.pinned === undefined ? null : patch.pinned;
  await sql.query(
    `insert into of_fan_flag (creator_id, fan_key, favorite, muted, pinned_at, updated_by, updated_at)
     values ($1, $2, coalesce($3::boolean, false), coalesce($4::boolean, false), case when $5::boolean is true then now() else null end, $6, now())
     on conflict (creator_id, fan_key) do update set
       favorite = coalesce($3::boolean, of_fan_flag.favorite),
       muted = coalesce($4::boolean, of_fan_flag.muted),
       pinned_at = case
         when $5::boolean is null then of_fan_flag.pinned_at
         when $5::boolean then coalesce(of_fan_flag.pinned_at, now())
         else null
       end,
       updated_by = $6,
       updated_at = now()`,
    [input.creatorId, input.fanKey, patch.favorite ?? null, patch.muted ?? null, pinned, input.updatedBy],
  );
  const rows = await sql.query<FlagRow>(
    "select creator_id, fan_key, favorite, muted, pinned_at from of_fan_flag where creator_id = $1 and fan_key = $2",
    [input.creatorId, input.fanKey],
  );
  const row = rows[0];
  return {
    creatorId: input.creatorId,
    fanKey: input.fanKey,
    favorite: row ? yes(row.favorite) : false,
    muted: row ? yes(row.muted) : false,
    pinnedAt: row?.pinned_at == null ? null : new Date(row.pinned_at).toISOString(),
  };
}

/**
 * Marcas con los cambios que aún no ha confirmado el servidor. Así la lista cambia al pulsar
 * y un refresco automático que llega antes de guardar no devuelve el chat a su sitio.
 */
export function applyFlagOverrides(flags: readonly FanFlag[], overrides: Readonly<Record<string, FanFlag>>): FanFlag[] {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return [...flags];
  const rest = flags.filter((flag) => !(flagKey(flag) in overrides));
  const extra = keys.map((key) => overrides[key] as FanFlag).filter((flag) => flag.favorite || flag.muted || flag.pinnedAt);
  return [...rest, ...extra];
}

export function flagKey(flag: { creatorId: string; fanKey: string }): string {
  return `${flag.creatorId}\u001f${flag.fanKey}`;
}

/** La marca resultante de aplicar un parche a la actual. Fijar pone la hora; desfijar la quita. */
export function patchedFlag(current: FanFlag | null, target: { creatorId: string; fanKey: string }, patch: FanFlagPatch, nowIso: string): FanFlag {
  return {
    creatorId: target.creatorId,
    fanKey: target.fanKey,
    favorite: patch.favorite ?? current?.favorite ?? false,
    muted: patch.muted ?? current?.muted ?? false,
    pinnedAt: patch.pinned === undefined ? current?.pinnedAt ?? null : patch.pinned ? current?.pinnedAt ?? nowIso : null,
  };
}
