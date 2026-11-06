import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { DataSlice } from "@/lib/crm";

export type SharedSlice = Pick<
  DataSlice,
  | "agency"
  | "creators"
  | "fans"
  | "messages"
  | "vault"
  | "scripts"
  | "lists"
  | "campaigns"
  | "employees"
  | "links"
  | "automations"
  | "history"
  | "stopWords"
  | "copilot"
  | "translate"
  | "adaptPrices"
  | "notifyShifts"
>;

export function snapshot(state: DataSlice): SharedSlice {
  return {
    agency: state.agency,
    creators: state.creators,
    fans: state.fans,
    messages: state.messages,
    vault: state.vault,
    scripts: state.scripts,
    lists: state.lists,
    campaigns: state.campaigns,
    employees: state.employees,
    links: state.links,
    automations: state.automations,
    history: state.history,
    stopWords: state.stopWords,
    copilot: state.copilot,
    translate: state.translate,
    adaptPrices: state.adaptPrices,
    notifyShifts: state.notifyShifts,
  };
}

export const loadWorkspace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    const rows = await sql<{ state: SharedSlice | string; version: number }>`
      select state, version from workspace_state where id = 1
    `;
    const row = rows[0];
    if (!row) return { state: null as SharedSlice | null, version: 0, access };
    const state = typeof row.state === "string" ? (JSON.parse(row.state) as SharedSlice) : row.state;
    return { state, version: Number(row.version), access };
  });

export const saveWorkspace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { state: SharedSlice; expectedVersion: number }) => input)
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const { commitWorkspace, ensureStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    const result = await commitWorkspace(sql, context.userId, data.expectedVersion, data.state, access);
    if (result.ok || result.reason === "forbidden") return result;
    return {
      ok: false as const,
      reason: "conflict" as const,
      version: result.version,
      state: result.state as SharedSlice | null,
    };
  });

export const updateStaffAccess = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string; perms: string[]; creatorIds: string[] }) => input)
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff, setCreatorGrant, setStaffPerms, readAccess } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const actor = await ensureStaff(sql, context.userId, devMode);
    await setStaffPerms(sql, actor, data.userId, data.perms);
    const current = await readAccess(sql, data.userId, false);
    for (const creatorId of current.creatorIds) {
      if (!data.creatorIds.includes(creatorId)) await setCreatorGrant(sql, actor, data.userId, creatorId, false);
    }
    for (const creatorId of data.creatorIds) {
      if (!current.creatorIds.includes(creatorId)) await setCreatorGrant(sql, actor, data.userId, creatorId, true);
    }
    return ensureStaff(sql, context.userId, devMode);
  });

export const updateStaffAlert = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string; phone: string; enabled: boolean; quietMinutes: number }) => input)
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff, setStaffAlert } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const actor = await ensureStaff(sql, context.userId, devMode);
    await setStaffAlert(sql, actor, data.userId, data);
    return { ok: true as const };
  });

export const listTeam = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff, listStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    if (access.role !== "owner") return { access, staff: [] as Awaited<ReturnType<typeof listStaff>> };
    return { access, staff: await listStaff(sql) };
  });
