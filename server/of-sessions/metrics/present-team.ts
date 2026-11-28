import { canSeeAgencyEarnings, canSeeChatterFigures, type TeamAccess } from "../../../src/lib/access-policy.ts";
import { chatterReports, type Attribution, type MassLaunch, type TeamMessage, type TeamSale } from "./team.ts";

export type TeamMetricRow = {
  userId: string;
  name: string;
  grossCents: number | null;
  ppvSent: number | null;
  ppvBought: number | null;
  firstReplyMinutes: number | null;
  threads: number | null;
};

/**
 * Un miembro ve todas las conversaciones, pero las cifras que salen de aquí
 * son solo las suyas. Los mensajes de otros autores entran en el cálculo para
 * no atribuir dos veces la misma venta, y luego se descartan.
 */
export function presentTeamMetrics(
  access: TeamAccess | null,
  messages: TeamMessage[],
  sales: TeamSale[],
  names: ReadonlyMap<string, string>,
  extra: { launches?: MassLaunch[]; attributions?: Attribution[] } = {},
): TeamMetricRow[] {
  if (!access) return [];
  const scoped = access.role === "owner" || access.perms.includes("mensajes") || canSeeAgencyEarnings(access)
    ? { messages, sales, launches: extra.launches, attributions: extra.attributions }
    : { messages: [], sales: [], launches: [], attributions: [] };
  return chatterReports(scoped)
    .filter((row) => canSeeChatterFigures(access, row.userId))
    .map((row) => ({
      userId: row.userId,
      name: names.get(row.userId) ?? row.userId,
      grossCents: canSeeAgencyEarnings(access) || row.userId === access.userId ? row.grossCents : null,
      ppvSent: row.ppvSent,
      ppvBought: row.ppvBought,
      firstReplyMinutes: row.firstReplyMinutes,
      threads: row.threads,
    }));
}
