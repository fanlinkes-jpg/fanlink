import { useEffect, useState, type ReactNode } from "react";
import { fanInsightModel } from "@/lib/fan-insights";
import { ppvTimeline, type PpvSource } from "@/lib/ppv-timeline";

export type FanProfileFields = {
  creatorId: string;
  fanKey: string;
  nickname: string | null;
  birthday: string | null;
  timezone: string | null;
  source: string | null;
  salaryCents: number | null;
  lastPayDate: string | null;
};

export type FanInsightProps = {
  name: string | null;
  handle: string | null;
  spentCents: number | null;
  tipsCents: number | null;
  status: "active" | "expired" | null;
  expiresAt: string | null;
  renewAuto: boolean | null;
  subPriceCents: number | null;
  subscribedAt?: string | null;
  notes: string;
  notesEditable: boolean;
  onNotes: (value: string) => void;
  transactions: Array<{ occurredAt: string; grossCents: number; kind: string }>;
  ppvPrices: number[];
  lists?: string[] | null;
  profile?: FanProfileFields | null;
  onProfile?: (profile: FanProfileFields) => void;
  threadMessages?: PpvSource[];
  onCopyDraft?: (body: string, priceCents: number) => void;
};

const TABS = ["Insights", "Ventas", "Notas"] as const;

export function FanInsights(props: FanInsightProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Insights");
  const model = fanInsightModel({
    spentCents: props.spentCents,
    tipsCents: props.tipsCents,
    status: props.status,
    expiresAt: props.expiresAt,
    renewAuto: props.renewAuto,
    subPriceCents: props.subPriceCents,
    subscribedAt: props.subscribedAt,
    notes: props.notes,
    transactions: props.transactions,
    ppvPrices: props.ppvPrices,
  });
  return (
    <aside className="flex h-full min-h-0 flex-col bg-[#f7f8fb]">
      <div className="border-b border-[#e6e8ee] bg-white px-4 py-3">
        <p className="text-sm font-semibold">Ficha del fan</p>
        <p className="truncate text-xs text-[#6d7585]">{props.name ?? "Fan"}{props.handle ? ` · @${props.handle.replace(/^@/, "")}` : ""}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "Notas" ? (
          <label className="flex flex-col gap-2 text-xs text-[#6d7585]">
            Notas
            <textarea
              value={props.notes}
              readOnly={!props.notesEditable}
              onChange={(event) => props.onNotes(event.target.value)}
              placeholder="Sin datos"
              className="min-h-40 rounded-xl border border-[#e6e8ee] bg-white p-3 text-sm text-[#1c2333]"
            />
          </label>
        ) : tab === "Ventas" ? (
          <SalesPane messages={props.threadMessages ?? []} onCopy={props.onCopyDraft} />
        ) : (
          <div className="space-y-3">
            <Card title="Comportamiento de gasto">
              <div className="grid grid-cols-2 gap-3">
                <Pair label="Gasto total" value={model.total} />
                <Pair label="Último gasto" value={model.lastAgo === "Sin datos" ? "Sin datos" : `${model.lastAgo} · ${model.last}`} />
              </div>
              <Pair label="Tipo del último" value={model.last} />
              <Pair label="PPV total" value={model.ppvTotal} />
              <Pair label="PPV medio" value={model.ppvAvg} />
              <Pair label="Propinas" value={model.tipTotal} />
              <Pair label="Propina media" value={model.tipAvg} />
              <Pair label="Gasto máximo" value={model.max} />
            </Card>
            <Card title="Métricas">
              <Pair label="Poder de gasto" value={model.power} />
              <Pair label="Riesgo de contracargo" value={model.chargeback} />
            </Card>
            <Card title="Suscripción">
              <Pair label="Estado" value={model.status === "Activa" && model.expires.startsWith("Caduca:") ? model.expires : model.status} />
              <Pair label="Coste" value={model.price === "Sin datos" ? "Sin datos" : `${model.price}/mes`} />
              <Pair label="Duración" value={model.duration} />
              <Pair label="Auto-renovación" value={model.renew} />
            </Card>
            <Card title="Perfil">
              <ProfileFields profile={props.profile ?? null} onSave={props.onProfile} />
            </Card>
            <Card title="Listas">
              {props.lists == null || props.lists.length === 0 ? <p className="text-sm text-[#6d7585]">Sin datos</p> : (
                <div className="flex flex-wrap gap-1">
                  {props.lists.map((name) => <span key={name} className="rounded-full bg-[#eef2ff] px-2 py-1 text-xs text-[#2456c7]">{name}</span>)}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 border-t border-[#e6e8ee] bg-white">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`py-3 text-xs ${tab === item ? "font-semibold text-[#2456c7]" : "text-[#6d7585]"}`}
          >
            {item}
          </button>
        ))}
      </div>
    </aside>
  );
}

function SalesPane({ messages, onCopy }: { messages: PpvSource[]; onCopy?: (body: string, priceCents: number) => void }) {
  const timeline = ppvTimeline(messages);
  return (
    <div className="space-y-3">
      <Card title="PPV">
        <Pair label="Buy rate" value={timeline.rate} />
        <Pair label="Precio más alto" value={timeline.high} />
        <Pair label="Precio más bajo" value={timeline.low} />
      </Card>
      {timeline.rows.length === 0 ? <p className="text-sm text-[#6d7585]">Sin datos</p> : timeline.rows.map((row) => (
        <article key={row.messageKey} className="rounded-xl border border-[#e6e8ee] bg-white p-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">{row.price}</span>
            <span className={row.state === "comprado" ? "text-[#137333]" : row.state === "no comprado" ? "text-[#b4234a]" : "text-[#6d7585]"}>
              {row.state === "comprado" ? "$ comprado" : row.state === "no comprado" ? "candado · no comprado" : "Sin datos"}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#6d7585]">{row.sentAt.slice(0, 16).replace("T", " ")}</p>
          <p className="mt-2 text-sm">{row.body}</p>
          {row.preview ? <img src={row.preview} alt="" className="mt-2 h-16 w-16 rounded object-cover" /> : <p className="mt-2 text-xs text-[#6d7585]">{row.media}</p>}
          {onCopy ? (
            <button type="button" className="mt-2 rounded border border-[#e6e8ee] px-2 py-1 text-xs" onClick={() => onCopy(row.body, row.priceCents)}>Copiar como borrador</button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ProfileFields({
  profile,
  onSave,
}: {
  profile: FanProfileFields | null;
  onSave?: (profile: FanProfileFields) => void;
}) {
  const [form, setForm] = useState({
    nickname: profile?.nickname ?? "",
    birthday: profile?.birthday ?? "",
    timezone: profile?.timezone ?? "",
    source: profile?.source ?? "",
    salary: profile?.salaryCents == null ? "" : (profile.salaryCents / 100).toFixed(2),
    lastPayDate: profile?.lastPayDate ?? "",
  });
  useEffect(() => {
    setForm({
      nickname: profile?.nickname ?? "",
      birthday: profile?.birthday ?? "",
      timezone: profile?.timezone ?? "",
      source: profile?.source ?? "",
      salary: profile?.salaryCents == null ? "" : (profile.salaryCents / 100).toFixed(2),
      lastPayDate: profile?.lastPayDate ?? "",
    });
  }, [profile]);
  if (!profile?.fanKey || !onSave) return <p className="text-sm text-[#6d7585]">Sin datos</p>;
  const commit = () => {
    const salary = form.salary.trim();
    const cents = salary === "" ? null : Number(salary);
    onSave({
      creatorId: profile.creatorId,
      fanKey: profile.fanKey,
      nickname: form.nickname.trim() || null,
      birthday: form.birthday || null,
      timezone: form.timezone.trim() || null,
      source: form.source.trim() || null,
      salaryCents: cents == null || !Number.isFinite(cents) ? null : Math.round(cents * 100),
      lastPayDate: form.lastPayDate || null,
    });
  };
  return (
    <div className="space-y-2" onBlur={commit}>
      <Field label="Apodo" value={form.nickname} onChange={(value) => setForm({ ...form, nickname: value })} />
      <Field label="Cumpleaños" type="date" value={form.birthday} onChange={(value) => setForm({ ...form, birthday: value })} />
      <Field label="Zona" value={form.timezone} onChange={(value) => setForm({ ...form, timezone: value })} placeholder="Europe/Madrid" />
      <Field label="Origen" value={form.source} onChange={(value) => setForm({ ...form, source: value })} />
      <Field label="Salario mensual $" value={form.salary} onChange={(value) => setForm({ ...form, salary: value })} />
      <Field label="Último pago" type="date" value={form.lastPayDate} onChange={(value) => setForm({ ...form, lastPayDate: value })} />
      <LocalClock zone={form.timezone} />
    </div>
  );
}

function LocalClock({ zone }: { zone: string }) {
  if (!zone.trim()) return <Pair label="Hora local" value="Sin datos" />;
  try {
    const time = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: zone.trim() }).format(new Date());
    return <Pair label="Hora local" value={`${time} · ${zone.trim()}`} />;
  } catch {
    return <Pair label="Hora local" value="Sin datos" />;
  }
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block text-xs text-[#6d7585]">
      {label}
      <input type={type} value={value} placeholder={placeholder ?? "Sin datos"} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-[#e6e8ee] px-2 py-1 text-sm text-[#1c2333]" />
    </label>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open className="rounded-xl border border-[#e6e8ee] bg-white">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{title}</summary>
      <div className="space-y-2 px-3 pb-3">{children}</div>
    </details>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-[#6d7585]">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
