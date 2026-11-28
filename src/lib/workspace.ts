import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { normalizeDashboardConfig } from "@/lib/dashboard-config";
import type { DataSlice } from "@/lib/crm";
import type { WorkspaceSlice } from "@/lib/access-policy";

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
  | "dashboardConfig"
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
    dashboardConfig: normalizeDashboardConfig(state.dashboardConfig),
  };
}

export const loadWorkspace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff } = await import("@/lib/workspace-store");
    const { scopeWorkspaceFor } = await import("@/lib/access-policy");
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
    // Un miembro recibe solo sus creadoras asignadas. La dueña, todo.
    const scoped = scopeWorkspaceFor(access, state as unknown as WorkspaceSlice) as unknown as SharedSlice;
    return { state: scoped, version: Number(row.version), access };
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
      updatedBy: result.updatedBy,
    };
  });

export const adoptStaffDisplayName = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { displayName: string }) => input)
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const { adoptStaffName, ensureStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    await ensureStaff(sql, context.userId, devMode);
    const adopted = await adoptStaffName(sql, context.userId, data.displayName);
    const access = await ensureStaff(sql, context.userId, devMode);
    return { displayName: adopted ?? access.displayName, access };
  });

export const saveStaffDisplayName = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { displayName: string }) => input)
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff, setOwnDisplayName } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    await ensureStaff(sql, context.userId, devMode);
    const displayName = await setOwnDisplayName(sql, context.userId, data.displayName);
    return { displayName, access: await ensureStaff(sql, context.userId, devMode) };
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
