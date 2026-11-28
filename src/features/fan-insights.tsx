import { useEffect, useState, type ReactNode } from "react";
import { FAN_CARD_TABS } from "@/lib/fan-card-tabs";
import { fanInsightModel } from "@/lib/fan-insights";
import { clipLabel, ppvDateLabel, ppvTimeline, type PpvRow, type PpvSource } from "@/lib/ppv-timeline";

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
  initialTab?: (typeof FAN_CARD_TABS)[number];
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
  /** Compras y PPV de todo el hilo guardado. Null mientras no han llegado. */
  purchases?: Array<{ sentAt: string; priceCents: number }> | null;
  messagesCents?: number | null;
  subscribesCents?: number | null;
  postsCents?: number | null;
  rank?: { fans: number; above: number; mineCents: number } | null;
  chargebacks?: number | null;
  subMonths?: number | null;
  lists?: string[] | null;
  profile?: FanProfileFields | null;
  onProfile?: (profile: FanProfileFields) => void;
  threadMessages?: PpvSource[];
  onCopyDraft?: (body: string, priceCents: number) => void;
  creatorNote?: { body: string; authorName: string | null; updatedAt: string } | null;
  onCreatorNote?: (body: string) => void;
};

export function FanInsights(props: FanInsightProps) {
  const [tab, setTab] = useState<(typeof FAN_CARD_TABS)[number]>(props.initialTab ?? "Insights");
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
    purchases: props.purchases ?? null,
    messagesCents: props.messagesCents ?? null,
    subscribesCents: props.subscribesCents ?? null,
    postsCents: props.postsCents ?? null,
    rank: props.rank ?? null,
    chargebacks: props.chargebacks ?? null,
    subMonths: props.subMonths ?? null,
  });
  return (
    <aside className="flex min-h-0 flex-1 flex-col bg-[#f7f8fb]">
      <div className="shrink-0 border-b border-[#e6e8ee] bg-white px-4 py-3">
        <p className="text-sm font-semibold">Ficha del fan</p>
        <p className="truncate text-xs text-[#6d7585]">{props.name ?? "Fan"}{props.handle ? ` · @${props.handle.replace(/^@/, "")}` : ""}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "Notas" ? (
          <CreatorNote note={props.creatorNote ?? null} onSave={props.onCreatorNote} />
        ) : tab === "Ventas" ? (
          <SalesPane messages={props.threadMessages ?? []} purchases={props.purchases ?? null} onCopy={props.onCopyDraft} />
        ) : (
          <div className="space-y-3">
            <Card title="Comportamiento de gasto">
              <div className="grid grid-cols-2 gap-3">
                <Pair label="Gasto total" value={model.total} />
                <Pair label="Último gasto" value={model.lastAgo === "Sin datos" ? "Sin datos" : `${model.lastAgo} · ${model.last}`} />
              </div>
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
      <div className="grid shrink-0 grid-cols-3 border-t border-[#e6e8ee] bg-white">
        {FAN_CARD_TABS.map((item) => (
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

function CreatorNote({
  note,
  onSave,
}: {
  note: { body: string; authorName: string | null; updatedAt: string } | null;
  onSave?: (body: string) => void;
}) {
  const [body, setBody] = useState(note?.body ?? "");
  const [stamp, setStamp] = useState(note?.updatedAt ?? "");
  useEffect(() => {
    setBody(note?.body ?? "");
    setStamp(note?.updatedAt ?? "");
  }, [note?.body, note?.updatedAt]);
  useEffect(() => {
    if (!onSave || body === (note?.body ?? "")) return;
    const timer = setTimeout(() => onSave(body), 700);
    return () => clearTimeout(timer);
  }, [body, note?.body, onSave]);
  const when = stamp ? stamp.slice(0, 16).replace("T", " ") : "";
  return (
    <label className="flex flex-col gap-2 text-xs text-[#6d7585]">
      Notas de la creadora
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Sin datos"
        className="min-h-40 rounded-xl border border-[#e6e8ee] bg-white p-3 text-sm text-[#1c2333]"
      />
      <span>{note?.authorName || when ? `${note?.authorName ?? "Sin datos"} · ${when || "Sin datos"}` : "Sin datos"}</span>
    </label>
  );
}

function SalesPane({ messages, purchases, onCopy }: { messages: PpvSource[]; purchases: Array<{ sentAt: string; priceCents: number }> | null; onCopy?: (body: string, priceCents: number) => void }) {
  const timeline = ppvTimeline(messages, purchases);
  return (
    <div className="space-y-3">
      <Card title="PPV">
        <Pair label="Buy rate" value={timeline.rows.length === 0 ? "0%" : timeline.rate} />
        <Pair label="Precio más alto" value={timeline.rows.length === 0 ? "$0.00" : timeline.high} />
        <Pair label="Precio más bajo" value={timeline.rows.length === 0 ? "$0.00" : timeline.low} />
      </Card>
      {timeline.rows.length === 0 ? <p className="text-sm text-[#6d7585]">Sin datos</p> : timeline.rows.map((row) => (
        <PpvCard key={row.messageKey} row={row} onCopy={onCopy} />
      ))}
    </div>
  );
}

/** Un PPV como en Infloww: medios en una fila con duración y candado, precio rosa con fecha y texto plegable. */
function PpvCard({ row, onCopy }: { row: PpvRow; onCopy?: (body: string, priceCents: number) => void }) {
  const [open, setOpen] = useState(false);
  const long = row.body.length > 140 || row.body.split("\n").length > 2;
  return (
    <article className="rounded-xl border border-[#e6e8ee] bg-white p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="rounded-full bg-[#ff5a7a] px-2 py-0.5 text-xs font-semibold text-white">{row.price} · {ppvDateLabel(row.sentAt)}</span>
        <span className={row.state === "comprado" ? "text-[#137333]" : row.state === "no comprado" ? "text-[#b4234a]" : "text-[#6d7585]"}>
          {row.state === "comprado" ? "$ comprado" : row.state === "no comprado" ? "candado · no comprado" : "Sin datos"}
        </span>
      </div>
      {row.items.length > 0 ? (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {row.items.map((item, index) => (
            <figure key={index} className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-[#d7dee8]">
              {item.preview ? <img src={item.preview} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
              {item.locked ? <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] text-white" aria-label="Con candado">🔒</span> : null}
              {clipLabel(item.seconds) ? <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{clipLabel(item.seconds)}</span> : null}
            </figure>
          ))}
        </div>
      ) : <p className="mt-2 text-xs text-[#6d7585]">{row.media}</p>}
      {row.body ? (
        <>
          <p className={`mt-2 whitespace-pre-wrap break-words text-sm ${open ? "" : "line-clamp-2"}`}>{row.body}</p>
          {long ? <button type="button" className="mt-1 text-xs text-[#2456c7]" onClick={() => setOpen(!open)}>{open ? "Ver menos" : "Ver más"}</button> : null}
        </>
      ) : null}
      {onCopy ? (
        <button type="button" className="mt-2 rounded border border-[#e6e8ee] px-2 py-1 text-xs" onClick={() => onCopy(row.body, row.priceCents)}>Copiar como borrador</button>
      ) : null}
    </article>
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
