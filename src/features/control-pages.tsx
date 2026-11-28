import { initialOf } from "@/lib/initial";
import { useEffect, useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { isLast24h, money, timeAgo } from "@/lib/format";
import { messageValue, useCrm, type Platform } from "@/lib/crm";
import { CONNECTION_LABEL, IDENTITY_STATE_LABEL, SESSION_STATUS_LABEL, sessionActionLabel, type SessionStatus } from "@/lib/of-sessions";
import { SESSION_EXPIRED_LABEL, signedReadsBlocked } from "../../server/of-sessions/sync/session-link.ts";
import { canSeeAgencyEarnings, hasPerm } from "@/lib/access-policy";
import { useCreatorSessions } from "@/lib/use-creator-sessions";
import { useOfReads } from "@/lib/use-of-reads";
import type { CreatorEarningView, CreatorReadView } from "@/lib/of-sessions";
import { changeRatio, creatorReport, type MetricPeriod } from "@/lib/creator-metrics";
import { fanProfiles, rankFans } from "@/lib/fan-metrics";
import { listCreatorChats, listTeamMetrics, setCreatorProxy, type TeamMetricView } from "@/lib/of-sessions";
import { PLATFORMS } from "@/features/growth-pages";
import { Badge, Button, Field, Panel, Select } from "@/components/ui";
import { sourceLabel, syncStatusOf } from "@/lib/sync-status";

export function AnalyticsPage({
  initialView,
  embedded = false,
  period: periodProp,
  onPeriod,
}: {
  initialView?: "creadoras" | "equipo" | "fans";
  embedded?: boolean;
  period?: MetricPeriod;
  onPeriod?: (period: MetricPeriod) => void;
} = {}) {
  const [view, setView] = useState<"creadoras" | "equipo" | "fans">(initialView ?? "creadoras");
  const [ownPeriod, setOwnPeriod] = useState<MetricPeriod>("month");
  const period = periodProp ?? ownPeriod;
  const setPeriod = onPeriod ?? setOwnPeriod;
  const [teamRows, setTeamRows] = useState<TeamMetricView[]>([]);
  const [chatOkCreators, setChatOkCreators] = useState<string[]>([]);
  const [ppvRows, setPpvRows] = useState<Array<{ creatorId: string; fanKey: string | null; sentAt: string; priceCents: number | null; purchased: boolean | null }>>([]);
  useEffect(() => {
    void listTeamMetrics().then(setTeamRows).catch(() => setTeamRows([]));
    void listCreatorChats()
      .then((data) => {
        const ok = data.meta.filter((item) => item.status === "ok").map((item) => item.creatorId);
        setChatOkCreators(ok);
        const allowed = new Set(ok);
        setPpvRows(data.messages.filter((message) => allowed.has(message.creatorId)).map((message) => ({
          creatorId: message.creatorId,
          fanKey: message.fanKey,
          sentAt: message.sentAt,
          priceCents: message.priceCents,
          purchased: message.purchased,
        })));
      })
      .catch(() => {
        setChatOkCreators([]);
        setPpvRows([]);
      });
  }, []);
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const teamAccess = useCrm((s) => s.teamAccess);
  const reads = useOfReads();
  const owner = reads.role === "owner" || canSeeAgencyEarnings(teamAccess);
  const scopedCreators = creators.filter((c) => creatorId === "all" || c.id === creatorId);
  const report = owner ? scopedReport(scopedCreators.map((c) => c.id), reads.byCreator, period) : null;
  const chart = report?.series.map((point) => ({ day: point.label, amountCents: point.grossCents, currency: "USD" })) ?? [];

  return (
    <div className={embedded ? "space-y-4" : "space-y-4 p-4 md:p-6"}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {embedded ? (
          <p className="text-sm text-muted">Las cifras son las guardadas. Abrir esta pantalla no sincroniza. El servidor lo hace solo, cerca de un minuto después de arrancar y luego cada cierto tiempo.</p>
        ) : (
          <div>
            <h1 className="font-display text-2xl font-semibold">Analítica</h1>
            <p className="text-sm text-muted">Las cifras son las guardadas. Abrir esta pantalla no sincroniza. El servidor lo hace solo, cerca de un minuto después de arrancar y luego cada cierto tiempo.</p>
          </div>
        )}
        {embedded ? null : (
          <div className="flex gap-1 rounded-md border border-line p-1">
            {(["creadoras", "equipo", "fans"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 text-sm capitalize ${view === v ? "bg-raised text-fg" : "text-muted"}`}>
                {v}
              </button>
            ))}
          </div>
        )}
      </div>
      {owner ? (
        <SyncInterval
          minutes={reads.intervalMin}
          chatMinutes={reads.chatIntervalMin}
          onSave={(minutes, chatMinutes) => void reads.saveInterval(minutes, chatMinutes)}
        />
      ) : null}
      {reads.error ? <p className="text-sm text-[#8a5a12]">{reads.error}</p> : null}

      {view === "creadoras" && owner && (
        <>
          {report ? <CreatorPeriod report={report} period={period} onPeriod={setPeriod} /> : null}
          {chart.length === 0 ? (
            <p className="rounded-lg border border-line px-4 py-8 text-sm text-muted">Sin sincronizar</p>
          ) : (
            <Panel title="Ingresos sincronizados" bodyClass="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <XAxis dataKey="day" tick={{ fill: "var(--color-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip formatter={(v) => [centsLabel(Number(v), chart[0]?.currency ?? "USD"), "Día"]} contentStyle={{ background: "var(--color-raised)", border: "1px solid var(--color-line)", color: "var(--color-fg)" }} />
                  <Bar dataKey="amountCents" fill="var(--color-primary)" radius={6} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          )}
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-surface text-xs text-muted">
                <tr>{["Creadora", "Fans", "Ingresos", "Tipos", "Última sincronización", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {scopedCreators.map((c) => {
                  const read = reads.byCreator.get(c.id);
                  const moneyRows = read?.earnings ?? [];
                  const status = syncStatusOf({
                    earningsSyncedAt: read?.earningsSyncedAt ?? null,
                    fansSyncedAt: read?.fansSyncedAt ?? null,
                    chatSyncedAt: read?.chatSyncedAt ?? null,
                    chatStatus: read?.chatStatus ?? null,
                    chatReason: read?.chatReason ?? null,
                    lastStatus: read?.lastStatus ?? null,
                    lastReason: read?.lastReason ?? null,
                  });
                  return (
                    <tr key={c.id} className="border-t border-line">
                      <td className="px-3 py-3">{c.name}</td>
                      <td className="px-3 py-3 tabular-nums">{read?.fansSyncedAt ? read.fans.length : sourceLabel(status.fans)}</td>
                      <td className="px-3 py-3 tabular-nums">{read?.earningsSyncedAt ? centsLabel(sumCents(moneyRows), moneyRows[0]?.currency ?? "USD") : sourceLabel(status.earnings)}</td>
                      <td className="px-3 py-3 text-xs">{read?.earningsSyncedAt ? kindSummary(moneyRows) : "—"}</td>
                      <td className="px-3 py-3 text-xs">
                        <div data-testid="informe-chats">Chats sincronizados: {sourceLabel(status.chats)}</div>
                        <div data-testid="informe-earnings">Ingresos sincronizados: {sourceLabel(status.earnings)}</div>
                        {reads.runningCreatorIds.includes(c.id) || reads.pendingId === c.id ? <div className="text-[#8a5a12]">En curso</div> : null}
                      </td>
                      <td className="px-3 py-3">
                        <SyncControl
                          creatorId={c.id}
                          pending={reads.pendingId === c.id || reads.runningCreatorIds.includes(c.id)}
                          label="Forzar sincronización"
                          onSync={(id) => void reads.sync(id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Panel title="Movimientos">
            <TransactionList creators={scopedCreators.map((c) => ({ id: c.id, name: c.name }))} reads={reads.byCreator} />
          </Panel>
        </>
      )}

      {view === "creadoras" && !owner && (
        <p className="rounded-lg border border-line px-4 py-8 text-sm text-muted">Los ingresos los ve la dueña. Aquí no hay cifras globales.</p>
      )}

      {view === "equipo" && <TeamBoard rows={owner ? teamRows : teamRows.filter((row) => row.userId === teamAccess?.userId)} />}

      {view === "fans" && (
        <FanBoard
          rows={scopedCreators.flatMap((creator) => {
            const read = reads.byCreator.get(creator.id);
            if (!read?.fansSyncedAt) return [];
            return rankFans(fanProfiles({
              now: new Date(),
              ppvSynced: chatOkCreators.includes(creator.id),
              fans: read.fans.map((fan) => ({
                fanKey: fan.fanKey,
                name: fan.displayName ?? fan.handle,
                status: fan.status,
                subscribedAt: fan.subscribedAt,
                renewAuto: fan.renewAuto,
                spentCents: fan.spentCents,
                lastInteractionAt: ppvRows
                  .filter((row) => row.creatorId === creator.id && row.fanKey === fan.fanKey)
                  .map((row) => row.sentAt)
                  .sort()
                  .at(-1) ?? null,
              })),
              purchases: (read.transactions ?? []).map((tx) => ({ fanKey: tx.fanKey, occurredAt: tx.occurredAt, grossCents: tx.grossCents })),
              ppv: ppvRows.filter((row) => row.creatorId === creator.id),
            })).map((profile) => ({ ...profile, creatorName: creator.name }));
          })}
        />
      )}
    </div>
  );
}

export function AuditPage() {
  const messages = useCrm((s) => s.messages);
  const fans = useCrm((s) => s.fans);
  const creators = useCrm((s) => s.creators);
  const unsend = useCrm((s) => s.unsend);
  const openFan = useCrm((s) => s.openFan);
  const navigate = useNavigate();
  const [who, setWho] = useState("todos");
  const [kind, setKind] = useState("todos");
  const authors = ["todos", ...new Set(messages.filter((m) => m.from === "team").map((m) => m.author))];
  const rows = [...messages].reverse().filter((m) => m.from === "team").filter((m) => who === "todos" || m.author === who).filter((m) => {
    if (kind === "ppv") return Boolean(m.ppv);
    if (kind === "masivo") return Boolean(m.mass);
    if (kind === "retenido") return m.status === "retenido" || Boolean(m.flag);
    return true;
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Bandeja de mensajes</h1>
        <p className="text-sm text-muted">Control de calidad: todo lo que sale del equipo, incluidos los retenidos por palabras prohibidas.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Empleado">
          {authors.map((a) => <option key={a} value={a}>{a === "todos" ? "Todo el equipo" : a}</option>)}
        </Select>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
          <option value="todos">Todos</option>
          <option value="ppv">PPV</option>
          <option value="masivo">Masivos</option>
          <option value="retenido">Retenidos</option>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>{["Cuándo", "Quién", "Fan", "Mensaje", "Estado", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-line align-top">
                <td className="px-3 py-3 text-xs text-muted">{timeAgo(m.at)}</td>
                <td className="px-3 py-3">{m.author}<div className="text-xs text-muted">{creators.find((c) => c.id === m.creatorId)?.name}</div></td>
                <td className="px-3 py-3">{fans.find((f) => f.id === m.fanId)?.name}</td>
                <td className="max-w-xs px-3 py-3">
                  <p className="line-clamp-2">{m.text}</p>
                  {m.ppv && <p className="text-xs text-gold">{m.ppv.title} · {money(m.ppv.price)}{m.ppv.band ? ` · ${m.ppv.band}` : ""} · {m.ppv.unlocked ? "abierto" : "cerrado"}</p>}
                </td>
                <td className="px-3 py-3">
                  {m.unsent ? <Badge>Deshecho</Badge> : m.status === "retenido" ? <Badge tone="danger">Retenido · {m.flag}</Badge> : <Badge tone="primary">Enviado</Badge>}
                  {messageValue(m) > 0 && <div className="mt-1 text-xs text-gold">{money(messageValue(m))}</div>}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-1">
                    <Button variant="ghost" onClick={() => { openFan(m.fanId); void navigate({ to: "/mensajes" }); }}>Abrir</Button>
                    {!m.unsent && m.status === "enviado" && <Button variant="danger" onClick={() => unsend(m.id)}>Deshacer</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function centsLabel(cents: number, _currency?: string): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function sumCents(rows: CreatorEarningView[]): number {
  const parts = rows.filter((row) => row.kind !== "total").reduce((sum, row) => sum + row.amountCents, 0);
  if (parts > 0) return parts;
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

function kindSummary(rows: CreatorEarningView[]): string {
  const labels: Record<CreatorEarningView["kind"], string> = {
    total: "total",
    subscription: "suscripciones",
    tip: "propinas",
    message: "mensajes",
    post: "posts",
    stream: "directos",
    referral: "referidos",
  };
  const seen = [...new Set(rows.map((row) => labels[row.kind]))];
  return seen.length ? seen.join(", ") : "—";
}

const KIND_LABEL: Record<string, string> = {
  subscription: "Suscripción",
  renewal: "Renovación",
  tip: "Propina",
  message: "Mensaje",
  post: "Post",
  stream: "Stream",
  referral: "Referido",
};

function scopedReport(ids: string[], reads: Map<string, CreatorReadView>, period: MetricPeriod) {
  const rows = ids.map((id) => reads.get(id)).filter((row): row is CreatorReadView => Boolean(row));
  return creatorReport({
    now: new Date(),
    period,
    earningsSynced: rows.some((row) => row.earningsSyncedAt),
    fansSynced: rows.some((row) => row.fansSyncedAt),
    transactions: rows.flatMap((row) => row.transactions ?? []),
    earnings: rows.flatMap((row) => row.earnings ?? []),
    fans: rows.flatMap((row) => row.fans),
  });
}

function CreatorPeriod({
  report,
  period,
  onPeriod,
}: {
  report: ReturnType<typeof creatorReport>;
  period: MetricPeriod;
  onPeriod: (period: MetricPeriod) => void;
}) {
  const delta = changeRatio(report.grossCents, report.previousGrossCents);
  return (
    <Panel title="Periodo">
      <div className="mb-3 flex gap-1">
        {(["day", "week", "month"] as const).map((item) => (
          <button key={item} type="button" onClick={() => onPeriod(item)} className={`rounded-md px-2 py-1 text-xs ${period === item ? "bg-raised text-fg" : "text-muted"}`}>
            {item === "day" ? "Día" : item === "week" ? "Semana" : "Mes"}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Bruto" value={report.grossCents == null ? "Sin datos" : centsLabel(report.grossCents, "USD")} hint={delta == null ? "Sin comparación" : `${delta > 0 ? "+" : ""}${Math.round(delta * 100)}% vs anterior`} />
        <Metric label="Neto" value={report.netCents == null ? "Sin datos" : centsLabel(report.netCents, "USD")} hint={report.previousNetCents == null ? "Sin comparación" : `Anterior ${centsLabel(report.previousNetCents, "USD")}`} />
        <Metric label="ARPU" value={report.arpuCents == null ? "Sin datos" : centsLabel(report.arpuCents, "USD")} hint="Ingreso medio por fan activo" />
        <Metric label="Fans activos" value={report.activeFans == null ? "Sin datos" : String(report.activeFans)} hint={`Nuevos ${report.newFans ?? "Sin datos"} · expirados ${report.expiredFans ?? "Sin datos"}`} />
        <Metric label="Auto-renovación" value={report.renewalRatio == null ? "Sin datos" : `${Math.round(report.renewalRatio * 100)}%`} hint="Fans con el dato, no es la tasa del periodo" />
        <Metric label="Tipos" value={report.byKind.length === 0 ? "Sin datos" : report.byKind.map((item) => `${KIND_LABEL[item.kind] ?? item.kind} ${centsLabel(item.grossCents, "USD")}`).join(" · ")} hint="Desglose del periodo" />
      </div>
    </Panel>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

export { ProxyForm } from "@/components/proxy-form";

function TeamBoard({ rows }: { rows: TeamMetricView[] }) {
  return (
    <div>
      <p className="mb-2 text-sm text-muted">Cifras de los chats y propinas sincronizados. Cada chatter ve su bruto atribuido, no el de la agencia ni el de otro.</p>
      {rows.length === 0 ? <p className="text-sm text-muted">Sin datos</p> : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>{["Persona", "Ingresos atribuidos", "PPV", "Primera respuesta", "Conversaciones"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId} className="border-t border-line">
                <td className="px-3 py-3">{row.name}</td>
                <td className="px-3 py-3">{row.grossCents == null ? "Sin datos" : centsLabel(row.grossCents, "USD")}</td>
                <td className="px-3 py-3">{row.ppvSent == null ? "Sin datos" : `${row.ppvBought ?? 0}/${row.ppvSent}`}</td>
                <td className="px-3 py-3">{row.firstReplyMinutes == null ? "Sin datos" : `${row.firstReplyMinutes} min`}</td>
                <td className="px-3 py-3">{row.threads == null ? "Sin datos" : String(row.threads)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FanBoard({ rows }: { rows: Array<{ fanKey: string; name: string | null; creatorName: string; ltvCents: number | null; spend30Cents: number | null; lastPurchaseAt: string | null; purchases30: number | null; ppvReceived: number | null; ppvBought: number | null; segments: string[] }> }) {
  if (rows.length === 0) return <p className="rounded-lg border border-line px-4 py-8 text-sm text-muted">Sin sincronizar</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[880px] text-left text-sm">
        <thead className="bg-surface text-xs text-muted">
          <tr>{["Fan", "Creadora", "LTV", "30 días", "Última compra", "Frecuencia", "PPV", "Segmento"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((fan) => (
            <tr key={`${fan.creatorName}:${fan.fanKey}`} className="border-t border-line">
              <td className="px-3 py-3">{fan.name ?? fan.fanKey}</td>
              <td className="px-3 py-3">{fan.creatorName}</td>
              <td className="px-3 py-3 tabular-nums">{fan.ltvCents == null ? "Sin datos" : centsLabel(fan.ltvCents, "USD")}</td>
              <td className="px-3 py-3 tabular-nums">{fan.spend30Cents == null ? "Sin datos" : centsLabel(fan.spend30Cents, "USD")}</td>
              <td className="px-3 py-3">{fan.lastPurchaseAt?.slice(0, 10) ?? "Sin datos"}</td>
              <td className="px-3 py-3">{fan.purchases30 == null ? "Sin datos" : String(fan.purchases30)}</td>
              <td className="px-3 py-3">{fan.ppvReceived == null ? "Sin datos" : `${fan.ppvBought ?? 0}/${fan.ppvReceived}`}</td>
              <td className="px-3 py-3 text-xs">{fan.segments.length ? fan.segments.join(", ") : "Sin datos"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransactionList({
  creators,
  reads,
}: {
  creators: Array<{ id: string; name: string }>;
  reads: Map<string, CreatorReadView>;
}) {
  const rows = creators.flatMap((creator) =>
    (reads.get(creator.id)?.transactions ?? []).map((tx) => ({ ...tx, creatorName: creator.name })),
  );
  if (rows.length === 0) return <p className="text-sm text-muted">Sin datos</p>;
  return (
    <ul className="space-y-2 text-sm">
      {rows.slice(0, 40).map((tx) => (
        <li key={`${tx.creatorName}:${tx.txKey}`} className="flex justify-between gap-3">
          <span>
            {tx.occurredAt.slice(0, 10)} · {tx.kind}
            {tx.fanKey ? ` · ${tx.fanKey}` : ""}
          </span>
          <span className="tabular-nums">
            {`$${(tx.grossCents / 100).toFixed(2)}`}
            {tx.netCents == null ? " · neto Sin datos" : ` · neto $${(tx.netCents / 100).toFixed(2)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SyncInterval({
  minutes,
  chatMinutes,
  onSave,
}: {
  minutes: number;
  chatMinutes: number;
  onSave: (minutes: number, chatMinutes: number) => void;
}) {
  const [value, setValue] = useState(String(minutes));
  const [chats, setChats] = useState(String(chatMinutes));
  useEffect(() => setValue(String(minutes)), [minutes]);
  useEffect(() => setChats(String(chatMinutes)), [chatMinutes]);
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(Number(value), Number(chats));
      }}
    >
      <label className="text-muted" htmlFor="sync-interval">Ingresos cada</label>
      <input id="sync-interval" type="number" min={5} max={1440} value={value} onChange={(event) => setValue(event.target.value)} className="h-8 w-20 rounded-md border border-line bg-surface px-2" />
      <span className="text-muted">min</span>
      <label className="text-muted" htmlFor="chat-interval">Chats cada</label>
      <input id="chat-interval" type="number" min={1} max={30} value={chats} onChange={(event) => setChats(event.target.value)} className="h-8 w-20 rounded-md border border-line bg-surface px-2" />
      <span className="text-muted">min</span>
      <button type="submit" className="rounded-md border border-line px-2 py-1 text-xs">Guardar</button>
    </form>
  );
}

function SyncControl({ creatorId, pending, disabled, onSync, label }: { creatorId: string; pending: boolean; disabled?: boolean; onSync: (creatorId: string) => void; label: string }) {
  return (
    <button type="button" disabled={disabled || pending} onClick={() => onSync(creatorId)} className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs disabled:opacity-50">
      {pending ? "Sincronizando…" : label}
    </button>
  );
}

function identityTitle(live: { identityName: string | null; identityUserId: string | null; identityCheckedAt: string | null } | undefined): string | undefined {
  if (!live) return undefined;
  const parts = [
    live.identityName ? `Nombre: ${live.identityName}` : "",
    live.identityUserId ? `Id: ${live.identityUserId}` : "",
    live.identityCheckedAt ? `Última verificación: ${live.identityCheckedAt}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function sessionTone(status: SessionStatus): string {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700";
    case "pending_login":
      return "bg-amber-50 text-amber-700";
    case "expired":
      return "bg-red-50 text-red-700";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export { CreatorsPage } from "@/features/creators-page";

export function SettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const agency = useCrm((s) => s.agency);
  const setAgency = useCrm((s) => s.setAgency);
  const stopWords = useCrm((s) => s.stopWords);
  const addStopWord = useCrm((s) => s.addStopWord);
  const removeStopWord = useCrm((s) => s.removeStopWord);
  const translate = useCrm((s) => s.translate);
  const setTranslate = useCrm((s) => s.setTranslate);
  const copilot = useCrm((s) => s.copilot);
  const setCopilot = useCrm((s) => s.setCopilot);
  const adaptPrices = useCrm((s) => s.adaptPrices);
  const setAdaptPrices = useCrm((s) => s.setAdaptPrices);
  const notify = useCrm((s) => s.notifyShifts);
  const setNotify = useCrm((s) => s.setNotify);
  const [word, setWord] = useState("");

  return (
    <div className={embedded ? "space-y-4" : "space-y-4 p-4 md:p-6"}>
      {embedded ? null : (
        <div>
          <h1 className="font-display text-2xl font-semibold">Ajustes</h1>
          <p className="text-sm text-muted">La operación de Fanlink se guarda en este navegador. No hay conexión real con las plataformas.</p>
        </div>
      )}
      <Panel title="Agencia">
        <label className="block text-xs text-muted">Nombre
          <Field value={agency} onChange={(e) => setAgency(e.target.value)} className="mt-1" />
        </label>
        <p className="mt-3 text-sm text-muted">Moneda EUR · Zona Europe/Madrid · Sede Valladolid</p>
      </Panel>
      <Panel title="Traducción en Mensajes Pro">
        <label className="flex items-center justify-between gap-3 text-sm">
          Traducción para el equipo
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={translate !== false} onChange={(e) => setTranslate(e.target.checked)} />
        </label>
        <p className="mt-2 text-sm text-muted">En el hilo, cada mensaje muestra el texto original y debajo la traducción. El botón de la barra superior lo enciende o lo apaga.</p>
      </Panel>
      <Panel title="Copiloto y avisos">
        <label className="flex items-center justify-between gap-3 text-sm">
          Sugerencias de respuesta en el chat
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={copilot} onChange={(e) => setCopilot(e.target.checked)} />
        </label>
        <label className="mt-3 flex items-center justify-between gap-3 text-sm">
          Avisar si un turno se queda sin cobertura
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        </label>
      </Panel>
      <Panel title="Precio adaptado del PPV">
        <label className="flex items-center justify-between gap-3 text-sm">
          Cobrar según lo que compra cada fan
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={adaptPrices !== false} onChange={(e) => setAdaptPrices(e.target.checked)} />
        </label>
        <ul className="mt-3 space-y-1 text-sm text-muted">
          <li>Sin compras: ×0,55 sobre la base.</li>
          <li>Sin compra este mes, pero ya compró: ×0,70.</li>
          <li>Compra poco, menos de $50.00 en 30 días: ×0,80.</li>
          <li>Gasto medio: el precio base.</li>
          <li>Compra mucho: ×1,30.</li>
          <li>Máximo gasto, ballenas: ×1,55.</li>
        </ul>
        <p className="mt-2 text-xs text-muted">En campañas el importe es la base. Cada fan recibe el suyo.</p>
      </Panel>
      <Panel title="Palabras prohibidas">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addStopWord(word); setWord(""); }}>
          <Field value={word} onChange={(e) => setWord(e.target.value)} placeholder="Añadir palabra" />
          <Button type="submit">Añadir</Button>
        </form>
        <ul className="mt-3 flex flex-wrap gap-2">
          {stopWords.map((w) => (
            <li key={w}>
              <button className="rounded-md bg-danger/15 px-2 py-1 text-xs text-danger" onClick={() => removeStopWord(w)}>{w} ×</button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
