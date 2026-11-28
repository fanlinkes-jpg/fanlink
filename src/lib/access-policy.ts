import { sameDashboardConfig } from "./dashboard-config.ts";

export const TEAM_PERMS = [
  "mensajes",
  "precios",
  "vault",
  "campanas",
  "analitica",
  "equipo",
  "ajustes",
  /** Todas las creadoras y todos sus chats, sin asignación. */
  "todas",
  /** Cifras de la agencia: totales, ingresos y comisiones. */
  "estadisticas",
  /** Banco. */
  "banco",
  /** Estados de cuenta. */
  "estados",
] as const;

export type TeamPerm = (typeof TEAM_PERMS)[number];
export type TeamRole = "owner" | "member";

export type TeamAccess = {
  userId: string;
  role: TeamRole;
  perms: string[];
  creatorIds: string[];
};

export type WorkspaceRecord = { id: string; creatorId?: string };

export type WorkspaceSlice = {
  agency: string;
  creators: WorkspaceRecord[];
  fans: WorkspaceRecord[];
  messages: WorkspaceRecord[];
  vault: WorkspaceRecord[];
  scripts: unknown[];
  lists: unknown[];
  campaigns: unknown[];
  employees: unknown[];
  links: WorkspaceRecord[];
  automations: unknown[];
  history: unknown[];
  stopWords: unknown[];
  copilot: boolean;
  translate: boolean;
  adaptPrices: boolean;
  notifyShifts: boolean;
  /** Configuración de widgets. Ausente en filas anteriores: equivale al defecto. */
  dashboardConfig?: unknown;
};

export class WorkspaceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

export function emptyWorkspace(): WorkspaceSlice {
  return {
    agency: "",
    creators: [],
    fans: [],
    messages: [],
    vault: [],
    scripts: [],
    lists: [],
    campaigns: [],
    employees: [],
    links: [],
    automations: [],
    history: [],
    stopWords: [],
    copilot: true,
    translate: true,
    adaptPrices: true,
    notifyShifts: true,
  };
}

export function hasPerm(access: TeamAccess | null, perm: TeamPerm): boolean {
  if (!access) return false;
  if (access.role === "owner") return true;
  return access.perms.includes(perm);
}

export function assertOwnerForce(access: TeamAccess | null): void {
  if (access?.role === "owner") return;
  throw new WorkspaceAccessError("Solo la dueña puede forzar la sincronización.");
}

export type CreatorScope = { role: TeamRole; creatorIds: readonly string[]; perms?: readonly string[] };

/** La dueña ve todas las cuentas. Un miembro solo las que tienen una asignación activa (`creator_grant`). */
export function canAccessCreator(access: CreatorScope | null, creatorId: string): boolean {
  if (!access || !creatorId) return false;
  if (seesAllCreators(access)) return true;
  return access.creatorIds.includes(creatorId);
}

export function assertCreatorAccess(access: CreatorScope | null, creatorId: string, message = "Esa cuenta no está asignada a tu usuario."): void {
  if (!canAccessCreator(access, creatorId)) throw new WorkspaceAccessError(message);
}

export function canOperateCreator(access: TeamAccess | null, creatorId: string, perm: TeamPerm): boolean {
  if (!hasPerm(access, perm)) return false;
  return canAccessCreator(access, creatorId);
}

/** Cuentas cuyas conversaciones, fichas, bóveda y contadores puede leer esta persona: la dueña todas, un miembro las asignadas. */
export function creatorIdsForChats(access: CreatorScope | null, allCreatorIds: string[]): string[] {
  if (!access) return [];
  if (seesAllCreators(access)) return allCreatorIds;
  const allowed = new Set(access.creatorIds);
  return [...new Set(allCreatorIds.filter((id) => allowed.has(id)))];
}

/** Totales de la agencia, ingresos y comisiones: la dueña y quien tenga el permiso «estadisticas» (Admin, Supervisor). */
export function canSeeAgencyEarnings(access: { role: TeamRole; perms?: readonly string[] } | null): boolean {
  if (!access) return false;
  return access.role === "owner" || (access.perms?.includes("estadisticas") ?? false);
}

/** Banco: la dueña y quien tenga el permiso «banco». */
export function canSeeBank(access: { role: TeamRole; perms?: readonly string[] } | null): boolean {
  if (!access) return false;
  return access.role === "owner" || (access.perms?.includes("banco") ?? false);
}

/** Estados de cuenta: la dueña y quien tenga el permiso «estados». */
export function canSeeStatements(access: { role: TeamRole; perms?: readonly string[] } | null): boolean {
  if (!access) return false;
  return access.role === "owner" || (access.perms?.includes("estados") ?? false);
}

/** Todas las creadoras sin asignación: la dueña y quien tenga «todas». */
export function seesAllCreators(access: { role: TeamRole; perms?: readonly string[] } | null): boolean {
  if (!access) return false;
  return access.role === "owner" || (access.perms?.includes("todas") ?? false);
}

export function canSeeChatterFigures(access: TeamAccess | null, subjectUserId: string): boolean {
  if (!access) return false;
  if (access.role === "owner" || canSeeAgencyEarnings(access)) return true;
  return access.userId === subjectUserId;
}

function recordScope(record: WorkspaceRecord): string {
  return record.creatorId ?? record.id;
}

/** Cifras de dinero de una creadora o campaña que un miembro nunca recibe. */
const CREATOR_MONEY_KEYS = ["revenue30", "split"] as const;

function maskCreatorMoney(record: WorkspaceRecord): WorkspaceRecord {
  const copy: Record<string, unknown> = { ...record };
  if ("revenue30" in copy) copy.revenue30 = null;
  if ("split" in copy) copy.split = 0;
  return copy as WorkspaceRecord;
}

function maskCampaign(campaign: unknown): unknown {
  if (!campaign || typeof campaign !== "object" || !("earned" in campaign)) return campaign;
  return { ...(campaign as Record<string, unknown>), earned: 0 };
}

/**
 * Lo que el servidor entrega del espacio compartido. La dueña lo recibe entero. Un miembro solo recibe las
 * creadoras asignadas con sus fans, mensajes, bóveda y enlaces, sin comisión ni ingresos, y sin el histórico de la agencia.
 */
export function scopeWorkspaceFor(access: TeamAccess | null, slice: WorkspaceSlice): WorkspaceSlice {
  if (!access) return emptyWorkspace();
  const money = canSeeAgencyEarnings(access);
  if (access.role === "owner") return slice;
  const allowed = new Set(access.creatorIds);
  const all = seesAllCreators(access);
  const keep = (record: WorkspaceRecord) => all || allowed.has(recordScope(record));
  return {
    ...slice,
    creators: slice.creators.filter(keep).map((record) => (money ? record : maskCreatorMoney(record))),
    fans: slice.fans.filter(keep),
    messages: slice.messages.filter(keep),
    vault: slice.vault.filter(keep),
    links: slice.links.filter(keep),
    campaigns: money ? slice.campaigns : slice.campaigns.map(maskCampaign),
    history: money ? slice.history : [],
  };
}

function mergeRecords(
  access: TeamAccess,
  prev: WorkspaceRecord[],
  next: WorkspaceRecord[],
  restore?: (before: WorkspaceRecord, after: WorkspaceRecord) => WorkspaceRecord,
): WorkspaceRecord[] {
  const allowed = new Set(access.creatorIds);
  const all = seesAllCreators(access);
  const nextById = new Map(next.map((record) => [record.id, record]));
  const merged: WorkspaceRecord[] = [];
  const seen = new Set<string>();
  for (const before of prev) {
    seen.add(before.id);
    const after = nextById.get(before.id);
    if (after) {
      merged.push(restore ? restore(before, after) : after);
    } else if (!all && !allowed.has(recordScope(before))) {
      merged.push(before);
    }
  }
  for (const after of next) if (!seen.has(after.id)) merged.push(after);
  return merged;
}

/**
 * El miembro guarda lo que recibió, que es una parte. Se junta con lo que no ve para no borrarlo, y las cifras de
 * dinero que no recibió se conservan. Lo que toque fuera de sus cuentas queda en `assertWorkspaceChange`.
 */
export function mergeScopedWorkspace(access: TeamAccess, prev: WorkspaceSlice, next: WorkspaceSlice): WorkspaceSlice {
  if (access.role === "owner") return next;
  const money = canSeeAgencyEarnings(access);
  const keepMoney = (before: WorkspaceRecord, after: WorkspaceRecord): WorkspaceRecord => {
    if (money) return after;
    const restored: Record<string, unknown> = { ...after };
    for (const key of CREATOR_MONEY_KEYS) if (key in before) restored[key] = (before as Record<string, unknown>)[key];
    return restored as WorkspaceRecord;
  };
  const earnedBefore = new Map(
    prev.campaigns.flatMap((campaign) => {
      const row = campaign as { id?: string; earned?: unknown } | null;
      return row && typeof row.id === "string" ? [[row.id, row.earned] as const] : [];
    }),
  );
  return {
    ...next,
    creators: mergeRecords(access, prev.creators, next.creators, keepMoney),
    fans: mergeRecords(access, prev.fans, next.fans),
    messages: mergeRecords(access, prev.messages, next.messages),
    vault: mergeRecords(access, prev.vault, next.vault),
    links: mergeRecords(access, prev.links, next.links),
    campaigns: next.campaigns.map((campaign) => {
      const row = campaign as { id?: string; earned?: unknown } | null;
      if (!row || typeof row.id !== "string" || !earnedBefore.has(row.id)) return campaign;
      return { ...row, earned: earnedBefore.get(row.id) };
    }),
    history: prev.history,
  };
}

export function assertWorkspaceChange(access: TeamAccess, prev: WorkspaceSlice, next: WorkspaceSlice): void {
  if (access.role === "owner") return;

  if (!sameDashboardConfig(prev.dashboardConfig, next.dashboardConfig)) {
    throw new WorkspaceAccessError("Solo la dueña puede configurar el dashboard.");
  }

  const added = ids(next.creators).filter((id) => !ids(prev.creators).includes(id));
  const removed = ids(prev.creators).filter((id) => !ids(next.creators).includes(id));
  if (added.length > 0) {
    throw new WorkspaceAccessError("Solo la dueña puede añadir creadoras.");
  }
  if (removed.length > 0) {
    throw new WorkspaceAccessError("Solo la dueña puede quitar creadoras.");
  }
  if (!same(prev.employees, next.employees)) {
    throw new WorkspaceAccessError("El equipo lo administra la dueña en el servidor.");
  }

  const settingsChanged =
    prev.agency !== next.agency ||
    !same(prev.stopWords, next.stopWords) ||
    prev.copilot !== next.copilot ||
    prev.translate !== next.translate ||
    prev.adaptPrices !== next.adaptPrices ||
    prev.notifyShifts !== next.notifyShifts;
  if (settingsChanged && !access.perms.includes("ajustes")) {
    throw new WorkspaceAccessError("No tienes permiso para cambiar los ajustes.");
  }

  assertRecords(access, "equipo", prev.creators, next.creators, "No tienes acceso para editar esa creadora.");
  assertRecords(access, "mensajes", prev.fans, next.fans, "No tienes acceso a los fans de esa creadora.");
  assertRecords(access, "mensajes", prev.messages, next.messages, "No tienes acceso a los mensajes de esa creadora.");
  assertRecords(access, "vault", prev.vault, next.vault, "No tienes acceso a la bóveda de esa creadora.");
  assertRecords(access, "campanas", prev.links, next.links, "No tienes acceso a los enlaces de esa creadora.");

  if (!same(prev.campaigns, next.campaigns) || !same(prev.lists, next.lists) || !same(prev.scripts, next.scripts) || !same(prev.automations, next.automations)) {
    if (!access.perms.includes("campanas")) {
      throw new WorkspaceAccessError("No tienes permiso para campañas o listas.");
    }
  }
  if (!same(prev.history, next.history) && !access.perms.includes("analitica")) {
    throw new WorkspaceAccessError("No tienes permiso para la analítica.");
  }
}

function assertRecords(
  access: TeamAccess,
  perm: TeamPerm,
  prev: WorkspaceRecord[],
  next: WorkspaceRecord[],
  message: string,
): void {
  for (const id of changedIds(prev, next)) {
    const record = next.find((item) => item.id === id) ?? prev.find((item) => item.id === id);
    const creatorId = record?.creatorId ?? id;
    if (!access.perms.includes(perm)) {
      throw new WorkspaceAccessError(message);
    }
    if (!seesAllCreators(access) && !access.creatorIds.includes(creatorId)) {
      throw new WorkspaceAccessError(message);
    }
  }
}

function ids(records: WorkspaceRecord[]): string[] {
  return records.map((record) => record.id);
}

function changedIds(prev: WorkspaceRecord[], next: WorkspaceRecord[]): string[] {
  const prevById = new Map(prev.map((record) => [record.id, record]));
  const nextById = new Map(next.map((record) => [record.id, record]));
  const all = new Set([...prevById.keys(), ...nextById.keys()]);
  const changed: string[] = [];
  for (const id of all) {
    if (!same(prevById.get(id) ?? null, nextById.get(id) ?? null)) changed.push(id);
  }
  return changed;
}

/** jsonb no conserva el orden de las claves: se compara sin depender de él. */
function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}
