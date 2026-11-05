import { Link } from "@tanstack/react-router";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, pct, timeAgo } from "@/lib/format";
import { lastFanMessage, messageValue, revenue24h, useCrm } from "@/lib/crm";
import { Badge, Panel } from "@/components/ui";

export function HomePage() {
  const creators = useCrm((s) => s.creators);
  const fans = useCrm((s) => s.fans);
  const messages = useCrm((s) => s.messages);
  const employees = useCrm((s) => s.employees);
  const vault = useCrm((s) => s.vault);
  const history = useCrm((s) => s.history);
  const creatorId = useCrm((s) => s.creatorId);
  const openFan = useCrm((s) => s.openFan);

  const scopedFans = fans.filter((f) => creatorId === "all" || f.creatorId === creatorId);
  const scopedMsg = messages.filter((m) => creatorId === "all" || m.creatorId === creatorId);
  const live = revenue24h(scopedMsg);
  const ppv = scopedMsg.filter((m) => m.ppv && m.status === "enviado" && !m.unsent);
  const unlocked = ppv.filter((m) => m.ppv?.unlocked).length;
  const rate = ppv.length ? unlocked / ppv.length : 0;
  const active = scopedFans.filter((f) => f.status === "activo" || f.status === "nuevo" || f.status === "renovacion").length;
  const chatters = employees.filter((e) => e.role === "Chatter" && e.replyMin > 0);
  const reply = chatters.length ? Math.round(chatters.reduce((s, e) => s + e.replyMin, 0) / chatters.length) : 0;
  const chart = [...history, { day: "24 h", euros: live }];
  const best = [...vault].sort((a, b) => b.unlocks / Math.max(1, b.sent) - a.unlocks / Math.max(1, a.sent))[0];
  const risk = scopedFans.filter((f) => f.status === "renovacion" || f.status === "expirado");
  const slow = [...employees].filter((e) => e.replyMin > 0).sort((a, b) => b.replyMin - a.replyMin)[0];
  const recent = [...scopedMsg].filter((m) => !m.unsent).slice(-6).reverse();

  const kpis = [
    { label: "Ingresos 24 h", value: money(live), hint: "PPV desbloqueado + propinas" },
    { label: "Desbloqueo PPV", value: pct(rate), hint: `${unlocked} de ${ppv.length} envíos` },
    { label: "Fans activos", value: String(active), hint: `${risk.length} en riesgo de salida` },
    { label: "Respuesta media", value: `${reply} min`, hint: slow ? `Más lenta: ${slow.name.split(" ")[0]}` : "Sin chatters" },
  ];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Centro de mando</h1>
        <p className="text-sm text-muted">Qué está convirtiendo hoy en Fanlink y dónde intervenir.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <article key={k.label} className="rounded-lg border border-line bg-surface p-4">
            <p className="text-xs text-muted">{k.label}</p>
            <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{k.value}</p>
            <p className="mt-1 text-xs text-muted">{k.hint}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <Panel title="Tendencia de ingresos" className="lg:col-span-3" bodyClass="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart}>
              <XAxis dataKey="day" tick={{ fill: "var(--color-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                formatter={(v) => [money(Number(v)), "Ingresos"]}
                contentStyle={{ background: "var(--color-raised)", border: "1px solid var(--color-line)", borderRadius: 8, color: "var(--color-fg)" }}
              />
              <Area type="monotone" dataKey="euros" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.18} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Laboratorio de conversión" className="lg:col-span-2">
          <ul className="space-y-3 text-sm">
            {best && (
              <li>
                <p className="font-medium">{best.title} lidera el vault</p>
                <p className="text-muted">
                  Desbloqueo {pct(best.unlocks / Math.max(1, best.sent))} · {money(best.revenue)}. Úsalo en ballenas, no en fans fríos.
                </p>
              </li>
            )}
            <li>
              <p className="font-medium">{risk.length} fans a punto de irse</p>
              <p className="text-muted">La lista «En riesgo» ya tiene el guion de renovación. No mezcles esa campaña con descuentos generales.</p>
            </li>
            {slow && (
              <li>
                <p className="font-medium">{slow.name.split(" ")[0]} responde en {slow.replyMin} min</p>
                <p className="text-muted">Por encima del resto. Revisa su turno en Equipo antes de cargar más cuentas.</p>
              </li>
            )}
          </ul>
          <Link to="/vault" className="mt-4 inline-flex text-sm font-medium text-primary">
            Ver rendimiento del vault
          </Link>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Creadoras" bodyClass="p-0">
          <ul>
            {creators
              .filter((c) => creatorId === "all" || c.id === creatorId)
              .map((c) => (
                <li key={c.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                  <span className="grid h-9 w-9 place-items-center rounded-md text-xs font-semibold text-fg" style={{ background: `hsl(${c.hue} 32% 28%)` }}>
                    {c.name.slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate text-xs text-muted">{c.handle} · {c.platform} · {c.proxy}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums">{money(c.revenue30)}</p>
                    <p className={c.growth >= 0 ? "text-xs text-primary" : "text-xs text-danger"}>{pct(c.growth)} 30 d</p>
                  </div>
                </li>
              ))}
          </ul>
        </Panel>

        <Panel title="Actividad reciente" bodyClass="p-0">
          <ul>
            {recent.map((m) => {
              const fan = fans.find((f) => f.id === m.fanId);
              return (
                <li key={m.id}>
                  <Link
                    to="/mensajes"
                    onClick={() => openFan(m.fanId)}
                    className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-raised"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        <span className="font-medium">{m.author}</span>
                        <span className="text-muted"> · {fan?.name}</span>
                      </p>
                      <p className="truncate text-xs text-muted">{m.status === "retenido" ? `Retenido · ${m.flag}` : m.text}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {messageValue(m) > 0 && <Badge tone="gold">{money(messageValue(m))}</Badge>}
                      <p className="mt-1 text-xs text-muted">{timeAgo(m.at)}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
