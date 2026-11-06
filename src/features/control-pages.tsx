import { useEffect, useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { isLast24h, money, timeAgo } from "@/lib/format";
import { messageValue, useCrm, type Platform, type Role } from "@/lib/crm";
import { CONNECTION_LABEL, IDENTITY_STATE_LABEL, SESSION_STATUS_LABEL, sessionActionLabel, type SessionStatus } from "@/lib/of-sessions";
import { hasPerm } from "@/lib/access-policy";
import { listTeam, updateStaffAccess, updateStaffAlert } from "@/lib/workspace";
import { useCreatorSessions } from "@/lib/use-creator-sessions";
import { useOfReads } from "@/lib/use-of-reads";
import type { CreatorEarningView, CreatorReadView } from "@/lib/of-sessions";
import { changeRatio, creatorReport, type MetricPeriod } from "@/lib/creator-metrics";
import { fanProfiles, rankFans } from "@/lib/fan-metrics";
import { listCreatorChats, listTeamMetrics, setCreatorProxy, type TeamMetricView } from "@/lib/of-sessions";
import { PLATFORMS } from "@/features/growth-pages";
import { Badge, Button, Field, Panel, Select } from "@/components/ui";

export function AnalyticsPage() {
  const [view, setView] = useState<"creadoras" | "equipo" | "fans">("creadoras");
  const [period, setPeriod] = useState<MetricPeriod>("month");
  const [teamRows, setTeamRows] = useState<TeamMetricView[]>([]);
  const [ppvSynced, setPpvSynced] = useState(false);
  const [ppvRows, setPpvRows] = useState<Array<{ creatorId: string; fanKey: string | null; priceCents: number | null; purchased: boolean | null }>>([]);
  useEffect(() => {
    void listTeamMetrics().then(setTeamRows).catch(() => setTeamRows([]));
    void listCreatorChats()
      .then((data) => {
        setPpvRows(data.messages.map((message) => ({
          creatorId: message.creatorId,
          fanKey: message.fanKey,
          priceCents: message.priceCents,
          purchased: message.purchased,
        })));
        setPpvSynced(true);
      })
      .catch(() => setPpvSynced(false));
  }, []);
  const creators = useCrm((s) => s.creators);
  const employees = useCrm((s) => s.employees);
  const messages = useCrm((s) => s.messages);
  const creatorId = useCrm((s) => s.creatorId);
  const teamAccess = useCrm((s) => s.teamAccess);
  const reads = useOfReads();
  const owner = reads.role === "owner" || teamAccess?.role === "owner";
  const scopedCreators = creators.filter((c) => creatorId === "all" || c.id === creatorId);
  const recent = messages.filter((m) => isLast24h(m.at) && m.from === "team" && m.status === "enviado" && !m.unsent);
  const report = owner ? scopedReport(scopedCreators.map((c) => c.id), reads.byCreator, period) : null;
  const chart = report?.series.map((point) => ({ day: point.label, amountCents: point.grossCents, currency: "USD" })) ?? [];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Analítica</h1>
          <p className="text-sm text-muted">Las cifras son las guardadas. Abrir esta pantalla no sincroniza. El servidor lo hace solo, cerca de un minuto después de arrancar y luego cada cierto tiempo.</p>
        </div>
        <div className="flex gap-1 rounded-md border border-line p-1">
          {(["creadoras", "equipo", "fans"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 text-sm capitalize ${view === v ? "bg-raised text-fg" : "text-muted"}`}>
              {v}
            </button>
          ))}
        </div>
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
                  return (
                    <tr key={c.id} className="border-t border-line">
                      <td className="px-3 py-3">{c.name}</td>
                      <td className="px-3 py-3 tabular-nums">{read?.fansSyncedAt ? read.fans.length : "Sin sincronizar"}</td>
                      <td className="px-3 py-3 tabular-nums">{read?.earningsSyncedAt ? centsLabel(sumCents(moneyRows), moneyRows[0]?.currency ?? "USD") : "Sin sincronizar"}</td>
                      <td className="px-3 py-3 text-xs">{read?.earningsSyncedAt ? kindSummary(moneyRows) : "—"}</td>
                      <td className="px-3 py-3 text-xs">
                        <div>{syncAge(lastSyncAt(read))}</div>
                        <div className="text-[#8a5a12]">{syncStateLabel(reads.runningCreatorIds.includes(c.id) || reads.pendingId === c.id, read?.lastStatus, read?.lastReason)}</div>
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

      {view === "equipo" && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>{["Persona", "Rol", "Mensajes 24 h", "Ingresos", "Respuesta", "Turno hoy"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const mine = recent.filter((m) => m.creditedTo === e.id);
                const day = (new Date().getDay() + 6) % 7;
                return (
                  <tr key={e.id} className="border-t border-line">
                    <td className="px-3 py-3">{e.name}{e.online ? " · en línea" : ""}</td>
                    <td className="px-3 py-3">{e.role}</td>
                    <td className="px-3 py-3 tabular-nums">{mine.length}</td>
                    <td className="px-3 py-3 text-muted">Sin datos</td>
                    <td className="px-3 py-3 text-muted">Sin datos</td>
                    <td className="px-3 py-3 capitalize">{e.shifts[day]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TeamBoard rows={teamRows} />
        </div>
      )}

      {view === "fans" && (
        <FanBoard
          rows={scopedCreators.flatMap((creator) => {
            const read = reads.byCreator.get(creator.id);
            if (!read?.fansSyncedAt) return [];
            return rankFans(fanProfiles({
              now: new Date(),
              ppvSynced,
              fans: read.fans.map((fan) => ({
                fanKey: fan.fanKey,
                name: fan.displayName ?? fan.handle,
                status: fan.status,
                subscribedAt: fan.subscribedAt,
                renewAuto: fan.renewAuto,
                spentCents: fan.spentCents,
                lastInteractionAt: null,
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

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const SHIFT_STYLE = {
  mañana: "bg-[#e7f0ff] text-[#2456c7]",
  noche: "bg-[#efe8ff] text-[#5b3cc4]",
  libre: "bg-[#f3f4f6] text-[#8b93a3]",
} as const;

export function TeamPage() {
  const creators = useCrm((s) => s.creators);
  const employees = useCrm((s) => s.employees);
  const messages = useCrm((s) => s.messages);
  const togglePerm = useCrm((s) => s.togglePerm);
  const cycleShift = useCrm((s) => s.cycleShift);
  const addEmployee = useCrm((s) => s.addEmployee);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("Chatter");
  const perms = ["mensajes", "precios", "vault", "campanas", "analitica", "equipo", "ajustes"] as const;
  const today = (new Date().getDay() + 6) % 7;
  const recent = messages.filter((m) => isLast24h(m.at) && m.from === "team" && m.status === "enviado" && !m.unsent);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Empleados</h1>
        <p className="text-sm text-muted">Los turnos de abajo son de la consola. El acceso real está en el servidor y no cambia al elegir a otra persona.</p>
      </div>
      <TeamAccessPanel creatorIds={creators.map((creator) => creator.id)} />

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <p className="border-b border-line px-4 py-3 text-sm font-semibold">Métricas</p>
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              {["Persona", "Rol", "Horas sem.", "Mensajes 24 h", "Ventas 24 h", "PPV", "Propinas", "Respuesta", "Turno hoy"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const mine = recent.filter((m) => m.creditedTo === e.id);
              const sales = mine.reduce((sum, m) => sum + messageValue(m), 0);
              const tips = mine.reduce((sum, m) => sum + (m.tip ?? 0), 0);
              const ppv = mine.filter((m) => m.ppv?.unlocked).length;
              return (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-3 py-3 font-medium">
                    {e.name}
                    <span className={`ml-2 inline-block h-2 w-2 rounded-full ${e.online ? "bg-emerald-500" : "bg-[#d0d4dc]"}`} />
                  </td>
                  <td className="px-3 py-3">{e.role}</td>
                  <td className="px-3 py-3 tabular-nums">{e.shifts.reduce((n, shift) => n + (shift === "libre" ? 0 : 8), 0)} h</td>
                  <td className="px-3 py-3 tabular-nums">{mine.length}</td>
                  <td className="px-3 py-3 tabular-nums">{money(sales)}</td>
                  <td className="px-3 py-3 tabular-nums">{ppv}</td>
                  <td className="px-3 py-3 tabular-nums">{money(tips)}</td>
                  <td className="px-3 py-3">{e.replyMin ? `${e.replyMin} min` : "—"}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-lg px-2 py-1 text-xs capitalize ${SHIFT_STYLE[e.shifts[today]]}`}>{e.shifts[today]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <p className="border-b border-line px-4 py-3 text-sm font-semibold">Turnos</p>
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Persona</th>
              {DAYS.map((d, i) => (
                <th key={d} className={`px-2 py-2 font-medium ${i === today ? "text-[#2456c7]" : ""}`}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="px-3 py-3">
                  <p className="font-medium">{e.name}</p>
                  <p className="text-xs text-muted">{e.role}</p>
                </td>
                {e.shifts.map((shift, i) => (
                  <td key={`${e.id}-${DAYS[i]}`} className="px-2 py-2">
                    <button
                      onClick={() => cycleShift(e.id, i)}
                      className={`w-full rounded-lg px-1 py-2 text-xs capitalize ${SHIFT_STYLE[shift]} ${i === today ? "ring-2 ring-[#2456c7]" : ""}`}
                    >
                      {shift}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Panel title="Incorporar">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); addEmployee(name, role); setName(""); toast.success("Persona añadida"); }}>
          <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" required />
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Rol">
            {(["Manager", "Chatter", "VA"] as Role[]).map((r) => <option key={r}>{r}</option>)}
          </Select>
          <Button type="submit">Añadir</Button>
        </form>
      </Panel>
      <Panel title="Permisos" bodyClass="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">Persona</th>
              {perms.map((p) => <th key={p} className="px-2 py-2 font-medium capitalize">{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="py-2 pr-3">{e.name}</td>
                {perms.map((p) => (
                  <td key={p} className="px-2 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={e.perms.includes(p)}
                      disabled={e.role === "Dueña"}
                      onChange={() => togglePerm(e.id, p)}
                      aria-label={`${e.name} ${p}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function centsLabel(cents: number, currency: string): string {
  const major = (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${major} ${currency}`;
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
  };
  const seen = [...new Set(rows.map((row) => labels[row.kind]))];
  return seen.length ? seen.join(", ") : "—";
}

function lastSyncAt(read: { earningsSyncedAt: string | null; fansSyncedAt: string | null } | undefined): string | null {
  const times = [read?.earningsSyncedAt, read?.fansSyncedAt].filter((value): value is string => Boolean(value));
  return times.sort().at(-1) ?? null;
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
        <Metric label="Renovación" value={report.renewalRatio == null ? "Sin datos" : `${Math.round(report.renewalRatio * 100)}%`} hint="Sobre fans con el dato" />
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

function ProxyForm({ creatorId, label, onSaved }: { creatorId: string; label: string | null; onSaved: () => void }) {
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form
      className="mt-1 grid gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void setCreatorProxy({ data: { creatorId, proxy: server.trim() ? { server, username, password } : null } })
          .then(() => {
            setPassword("");
            onSaved();
          })
          .catch(() => undefined);
      }}
    >
      <span className="text-[#6d7585]">{label ? `Proxy ${label}` : "Sin proxy"}</span>
      <input value={server} onChange={(event) => setServer(event.target.value)} placeholder="http://host:puerto" className="h-7 rounded border border-[#e6e8ee] px-1" />
      <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="usuario" className="h-7 rounded border border-[#e6e8ee] px-1" />
      <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="contraseña" type="password" className="h-7 rounded border border-[#e6e8ee] px-1" />
      <button type="submit" className="rounded border border-[#e6e8ee] px-1 py-1 text-left">Guardar proxy</button>
    </form>
  );
}

function TeamBoard({ rows }: { rows: TeamMetricView[] }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-sm text-muted">Cifras de los chats y propinas sincronizados. Un chatter solo ve las suyas. El turno de arriba no sale de OnlyFans.</p>
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
            {(tx.grossCents / 100).toFixed(2)} {tx.currency}
            {tx.netCents == null ? " · neto Sin datos" : ` · neto ${(tx.netCents / 100).toFixed(2)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function syncAge(iso: string | null): string {
  if (!iso) return "Última sincronización: aún no";
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 1) return "Última sincronización: hace menos de 1 min";
  return `Última sincronización: hace ${mins} min`;
}

function syncStateLabel(running: boolean, status: "idle" | "ok" | "error" | undefined, reason: string | null | undefined): string {
  if (running) return "En curso";
  if (status === "error") return reason ? `Error · ${shortReason(reason)}` : "Error";
  if (status === "ok") return "OK";
  return "Sin sincronizar";
}

function shortReason(reason: string): string {
  const cut = reason.split(". json:")[0] ?? reason;
  const text = cut.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (/redirigido a login/i.test(text)) return "OnlyFans pide iniciar sesión: pulsa Reconectar";
  return text;
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

export function CreatorsPage() {
  const creators = useCrm((s) => s.creators);
  const employees = useCrm((s) => s.employees);
  const addCreator = useCrm((s) => s.addCreator);
  const sessions = useCreatorSessions();
  const reads = useOfReads();
  const teamAccess = useCrm((s) => s.teamAccess);
  const canOperate = hasPerm(teamAccess, "equipo");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nick, setNick] = useState("");
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<Platform>("OnlyFans");
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  const [platformFilter, setPlatformFilter] = useState("todas");
  const [tagFilter, setTagFilter] = useState("todas");
  const [sessionFilter, setSessionFilter] = useState("todas");
  const [staffFilter, setStaffFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todas");
  const tags = [...new Set(creators.map((c) => c.tag || c.city))];

  useEffect(() => {
    const defaults: Record<string, { nick: string; tag: string; staff: string[] }> = {
      "c-alba": { nick: "Alba Studio", tag: "estudio", staff: ["e-lucia", "e-marta", "e-diego"] },
      "c-nerea": { nick: "Nerea", tag: "lifestyle", staff: ["e-marta", "e-nora"] },
      "c-ines": { nick: "Inés Costa", tag: "costa", staff: ["e-diego", "e-hugo"] },
      "c-carla": { nick: "Carla", tag: "premium", staff: ["e-lucia", "e-nora"] },
    };
    if (!creators.some((c) => defaults[c.id] && !c.nick)) return;
    useCrm.setState((s) => ({
      creators: s.creators.map((c) => (defaults[c.id] && !c.nick ? { ...c, ...defaults[c.id] } : c)),
    }));
  }, [creators]);

  function statusOf(id: string): SessionStatus {
    return sessions.byCreator.get(id)?.status ?? "pending_login";
  }

  const rows = creators.filter((c) => {
    const blob = `${c.name} ${c.nick ?? ""} ${c.handle}`.toLowerCase();
    if (q && !blob.includes(q.toLowerCase())) return false;
    if (platformFilter !== "todas" && c.platform !== platformFilter) return false;
    if (tagFilter !== "todas" && (c.tag || c.city) !== tagFilter) return false;
    if (sessions.ready && !sessions.error && sessionFilter !== "todas" && statusOf(c.id) !== sessionFilter) return false;
    if (staffFilter !== "todos" && !(c.staff ?? []).includes(staffFilter)) return false;
    if (statusFilter !== "todas" && c.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="min-h-full bg-[#f4f6f8]">
      <div className="flex items-center justify-between border-b border-[#e6e8ee] bg-white px-4 py-3">
        <h1 className="font-display text-lg font-semibold">Administrar creadoras</h1>
        <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-full bg-[#ff7a2f] px-4 py-2 text-sm font-medium text-white">
          Añadir creadora
        </button>
      </div>

      {open && (
        <form
          className="grid gap-2 border-b border-[#e6e8ee] bg-white p-4 md:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            addCreator({ name, nick, handle, platform, city: "España", tag });
            setName("");
            setNick("");
            setHandle("");
            setTag("");
            setOpen(false);
            toast.success("Creadora añadida. La sesión queda pendiente de login.");
          }}
        >
          <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" required />
          <Field value={nick} onChange={(e) => setNick(e.target.value)} placeholder="Apodo" />
          <Field value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@cuenta" required />
          <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} aria-label="Plataforma">
            {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
          </Select>
          <Field value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Etiqueta" />
          <Button type="submit">Guardar</Button>
        </form>
      )}

      <div className="flex flex-wrap gap-2 px-4 py-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre de la creadora" className="h-9 rounded-lg border border-[#e6e8ee] bg-[#eef0f3] px-3 text-sm" />
        <Select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} aria-label="Plataforma" className="h-9 bg-[#eef0f3]">
          <option value="todas">Plataforma</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="Etiqueta" className="h-9 bg-[#eef0f3]">
          <option value="todas">Etiqueta</option>
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Select value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)} aria-label="Sesión" className="h-9 bg-[#eef0f3]">
          <option value="todas">Estado de sesión</option>
          <option value="active">Activa</option>
          <option value="pending_login">Pendiente de login</option>
          <option value="expired">Expirada</option>
        </Select>
        <Select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} aria-label="Empleado" className="h-9 bg-[#eef0f3]">
          <option value="todos">Empleado</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Estado de la cuenta" className="h-9 bg-[#eef0f3]">
          <option value="todas">Estado de la cuenta</option>
          <option value="activa">Activa</option>
          <option value="pausa">En pausa</option>
        </Select>
      </div>

      {sessions.error && (
        <p className="mx-4 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{sessions.error}</p>
      )}

      <div className="overflow-x-auto px-4 pb-6">
        <table className="w-full min-w-[980px] border-separate border-spacing-0 overflow-hidden rounded-xl bg-white text-left text-sm">
          <thead>
            <tr className="text-xs text-[#6d7585]">
              {["Creadora", "Apodo", "Etiqueta", "Sesión guardada", "Conexión", "Identidad", "Cuenta", "ID", "Empleados", "Acción"].map((h) => (
                <th key={h} className="border-b border-[#eef0f3] px-4 py-3 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const live = sessions.byCreator.get(c.id);
              const status = statusOf(c.id);
              const names = (c.staff ?? []).map((id) => employees.find((e) => e.id === id)?.name.split(" ")[0]).filter(Boolean);
              const action = live?.loginInProgress ? "Entrando…" : sessionActionLabel(status);
              return (
                <tr key={c.id} className="border-t border-[#f0f1f4]">
                  <td className="border-b border-[#f4f5f7] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-full text-xs font-semibold text-white" style={{ background: `hsl(${c.hue} 45% 42%)` }}>{c.name.slice(0, 1)}</span>
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </td>
                  <td className="border-b border-[#f4f5f7] px-4 py-3">{c.nick || c.name}</td>
                  <td className="border-b border-[#f4f5f7] px-4 py-3">{c.tag || c.city}</td>
                  <td className="border-b border-[#f4f5f7] px-4 py-3">
                    {live || (sessions.ready && !sessions.error) ? (
                      <span title={live?.lastError ?? undefined} className={`rounded-full px-2 py-1 text-xs ${sessionTone(status)}`}>
                        {SESSION_STATUS_LABEL[status]}
                      </span>
                    ) : sessions.ready ? (
                      <span className="text-xs text-[#8a5a12]">Sin datos</span>
                    ) : (
                      <span className="text-xs text-[#6d7585]">Cargando</span>
                    )}
                  </td>
                  <td className="border-b border-[#f4f5f7] px-4 py-3">
                    <span className="text-xs text-[#6d7585]">{live ? CONNECTION_LABEL[live.connection] : "Sin comprobar"}</span>
                  </td>
                  <td className="border-b border-[#f4f5f7] px-4 py-3">
                    <span className="text-xs" title={live?.identityReason ?? identityTitle(live)}>
                      {live ? IDENTITY_STATE_LABEL[live.identityState] : IDENTITY_STATE_LABEL.unavailable}
                      {live?.identityHandle ? ` · @${live.identityHandle.replace(/^@+/, "")}` : ""}
                      {live?.readsBlocked ? " · lecturas bloqueadas" : ""}
                    </span>
                    {live?.identityState === "unavailable" && live.identityReason ? (
                      <span className="mt-1 block max-w-[16rem] text-[10px] leading-snug text-[#8a5a12]" title={shortReason(live.identityReason)}>
                        {shortReason(live.identityReason)}
                      </span>
                    ) : null}
                  </td>
                  <td className="border-b border-[#f4f5f7] px-4 py-3">{c.platform}</td>
                  <td className="border-b border-[#f4f5f7] px-4 py-3 text-[#3b6cff]">{c.handle}</td>
                  <td className="border-b border-[#f4f5f7] px-4 py-3">{names.length ? names.join(", ") : "Sin asignar"}</td>
                  <td className="border-b border-[#f4f5f7] px-4 py-3">
                    <div className="flex gap-1">
                      <Link to="/conectar" search={{ creadora: c.id }} className="rounded-lg bg-[#ff7a2f] px-2 py-1 text-xs font-medium text-white">
                        {action}
                      </Link>
                      <button
                        type="button"
                        disabled={!canOperate || !live}
                        onClick={() => void sessions.check(c.id)}
                        className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs disabled:opacity-50"
                      >
                        Comprobar
                      </button>
                      <span className="inline-flex max-w-[16rem] flex-col text-[10px] leading-snug text-[#6d7585]">
                        <span>{syncAge(lastSyncAt(reads.byCreator.get(c.id)))}</span>
                        <span>
                          {syncStateLabel(reads.pendingId === c.id || reads.runningCreatorIds.includes(c.id), reads.byCreator.get(c.id)?.lastStatus, reads.byCreator.get(c.id)?.lastReason)}
                        </span>
                        {teamAccess?.role === "owner" ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer">Más</summary>
                            <SyncControl
                              creatorId={c.id}
                              pending={reads.pendingId === c.id || reads.runningCreatorIds.includes(c.id)}
                              disabled={!live || live.readsBlocked}
                              label="Forzar sincronización"
                              onSync={(id) => void reads.sync(id)}
                            />
                            <ProxyForm creatorId={c.id} label={live?.proxyLabel ?? null} onSaved={() => void sessions.refresh?.()} />
                          </details>
                        ) : null}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted">Ninguna sesión con esos filtros.</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-[#6d7585]">La sincronización es automática: abre ganancias y fans con el perfil de la cuenta y no envía nada. La fila muestra la última pasada. Solo la dueña puede forzarla desde Más. Si la identidad no coincide, no se lee.</p>
      </div>
    </div>
  );
}

export function SettingsPage() {
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
  const resetDemo = useCrm((s) => s.resetDemo);
  const [word, setWord] = useState("");

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Ajustes</h1>
        <p className="text-sm text-muted">La operación de Fanlink se guarda en este navegador. No hay conexión real con las plataformas.</p>
      </div>
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
          <li>Compra poco, menos de 50 € en 30 días: ×0,80.</li>
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
      <Panel title="Demostración">
        <p className="mb-3 text-sm text-muted">Vuelve a los datos de ejemplo de Fanlink si has hecho pruebas. En la base compartida eso lo guarda la dueña.</p>
        <Button variant="danger" onClick={() => { resetDemo(); toast.success("Datos restaurados"); }}>Restaurar demo</Button>
      </Panel>
    </div>
  );
}

function MemberGrants({
  person,
  creatorIds,
  onSave,
  onAlert,
}: {
  person: { userId: string; displayName: string; perms: string[]; creatorIds: string[]; phone: string | null; alertsEnabled: boolean; quietMinutes: number };
  creatorIds: string[];
  onSave: (userId: string, perms: string[], creatorIds: string[]) => Promise<void>;
  onAlert: (userId: string, phone: string, enabled: boolean, quietMinutes: number) => Promise<void>;
}) {
  const perms = ["mensajes", "precios", "vault", "campanas", "analitica", "equipo", "ajustes"] as const;
  return (
    <div className="mt-3 rounded-lg border border-line p-3 text-sm">
      <p className="font-medium">{person.displayName}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        {perms.map((perm) => (
          <label key={perm} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={person.perms.includes(perm)}
              onChange={() => {
                const next = person.perms.includes(perm) ? person.perms.filter((item) => item !== perm) : [...person.perms, perm];
                void onSave(person.userId, next, person.creatorIds);
              }}
            />
            {perm}
          </label>
        ))}
      </div>
      <AlertFields person={person} onAlert={onAlert} />
      <div className="mt-2 flex flex-wrap gap-3">
        {creatorIds.map((creatorId) => (
          <label key={creatorId} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={person.creatorIds.includes(creatorId)}
              onChange={() => {
                const next = person.creatorIds.includes(creatorId)
                  ? person.creatorIds.filter((item) => item !== creatorId)
                  : [...person.creatorIds, creatorId];
                void onSave(person.userId, person.perms, next);
              }}
            />
            {creatorId}
          </label>
        ))}
      </div>
    </div>
  );
}

function AlertFields({
  person,
  onAlert,
}: {
  person: { userId: string; phone: string | null; alertsEnabled: boolean; quietMinutes: number };
  onAlert: (userId: string, phone: string, enabled: boolean, quietMinutes: number) => Promise<void>;
}) {
  const [phone, setPhone] = useState(person.phone ?? "");
  const [enabled, setEnabled] = useState(person.alertsEnabled);
  const [quiet, setQuiet] = useState(String(person.quietMinutes));
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onAlert(person.userId, phone, enabled, Number(quiet) || 15);
      }}
    >
      <label className="text-xs text-muted">
        WhatsApp
        <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+34600000000" className="mt-1 block h-8 rounded-md border border-line px-2 text-sm" />
      </label>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Avisos
      </label>
      <label className="text-xs text-muted">
        Minutos entre avisos del mismo fan
        <input value={quiet} onChange={(event) => setQuiet(event.target.value)} inputMode="numeric" className="mt-1 block h-8 w-16 rounded-md border border-line px-2 text-sm" />
      </label>
      <button type="submit" className="rounded-md border border-line px-2 py-1 text-xs">Guardar aviso</button>
    </form>
  );
}

function TeamAccessPanel({ creatorIds }: { creatorIds: string[] }) {
  const access = useCrm((s) => s.teamAccess);
  const [staff, setStaff] = useState<Array<{ userId: string; displayName: string; role: "owner" | "member"; perms: string[]; creatorIds: string[]; phone: string | null; alertsEnabled: boolean; quietMinutes: number }>>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (access?.role !== "owner") return;
    let cancel = false;
    void listTeam()
      .then((result) => {
        if (!cancel) setStaff(result.staff);
      })
      .catch((error: unknown) => {
        if (!cancel) setNotice(error instanceof Error ? error.message : "No se ha podido leer el equipo.");
      });
    return () => {
      cancel = true;
    };
  }, [access?.role]);

  if (!access) return null;

  async function saveMember(userId: string, perms: string[], memberCreatorIds: string[]) {
    setNotice("");
    try {
      await updateStaffAccess({ data: { userId, perms, creatorIds: memberCreatorIds } });
      const result = await listTeam();
      setStaff(result.staff);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se ha podido guardar el acceso.");
    }
  }

  async function saveAlert(userId: string, phone: string, enabled: boolean, quietMinutes: number) {
    setNotice("");
    try {
      await updateStaffAlert({ data: { userId, phone, enabled, quietMinutes } });
      const result = await listTeam();
      setStaff(result.staff);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se ha podido guardar el aviso.");
    }
  }

  return (
    <Panel title="Acceso del servidor">
      <p className="text-sm">Sesión autenticada: {access.displayName}. {access.role === "owner" ? "Dueña" : "Miembro"}.</p>
      {access.devMode && (
        <p className="mt-2 text-sm text-[#8a5a12]">Modo local de un solo operador, solo en localhost. No separa a varias personas.</p>
      )}
      {access.role !== "owner" && (
        <p className="mt-2 text-sm text-muted">Los permisos y las creadoras los asigna la dueña. No se eligen en un desplegable.</p>
      )}
      {notice && <p className="mt-2 text-sm text-[#8a5a12]">{notice}</p>}
      {access.role === "owner" &&
        staff
          .filter((person) => person.role === "member")
          .map((person) => (
            <MemberGrants key={person.userId} person={person} creatorIds={creatorIds} onSave={saveMember} onAlert={saveAlert} />
          ))}
    </Panel>
  );
}
