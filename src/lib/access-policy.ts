export const TEAM_PERMS = [
  "mensajes",
  "precios",
  "vault",
  "campanas",
  "analitica",
  "equipo",
  "ajustes",
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

export function canOperateCreator(access: TeamAccess | null, creatorId: string, perm: TeamPerm): boolean {
  if (!hasPerm(access, perm)) return false;
  if (!access) return false;
  if (access.role === "owner") return true;
  return access.creatorIds.includes(creatorId);
}

export function assertWorkspaceChange(access: TeamAccess, prev: WorkspaceSlice, next: WorkspaceSlice): void {
  if (access.role === "owner") return;

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
    if (!access.perms.includes(perm) || !access.creatorIds.includes(creatorId)) {
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

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
