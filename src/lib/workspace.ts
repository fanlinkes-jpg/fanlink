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
    const sql = await getSql();
    await sql`insert into workspace_member (user_id) values (${context.userId}) on conflict (user_id) do nothing`;
    const rows = await sql<{ state: SharedSlice | string; version: number }>`
      select state, version from workspace_state where id = 1
    `;
    const row = rows[0];
    if (!row) return { state: null as SharedSlice | null, version: 0 };
    const state = typeof row.state === "string" ? (JSON.parse(row.state) as SharedSlice) : row.state;
    return { state, version: Number(row.version) };
  });

export const saveWorkspace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { state: SharedSlice }) => input)
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const member = await sql<{ user_id: string }>`
      select user_id from workspace_member where user_id = ${context.userId}
    `;
    if (!member.length) return { version: 0 };
    const rows = await sql.query<{ version: number }>(
      `insert into workspace_state (id, state, version, updated_by)
       values (1, $1::jsonb, 1, $2)
       on conflict (id) do update
       set state = excluded.state,
           version = workspace_state.version + 1,
           updated_at = now(),
           updated_by = excluded.updated_by
       returning version`,
      [JSON.stringify(data.state), context.userId],
    );
    return { version: Number(rows[0]?.version ?? 1) };
  });
