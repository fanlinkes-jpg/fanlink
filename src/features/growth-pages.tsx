import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { VaultBrowser } from "@/features/vault-browser";
import { money, pct } from "@/lib/format";
import { fansForList, useCrm, type Platform } from "@/lib/crm";
import { Badge, Button, Field, Panel, Select } from "@/components/ui";
import { CampaignDrafts } from "@/features/campaign-draft";

export function ListsPage() {
  const lists = useCrm((s) => s.lists);
  const fans = useCrm((s) => s.fans);
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const addList = useCrm((s) => s.addList);
  const removeList = useCrm((s) => s.removeList);
  const openFan = useCrm((s) => s.openFan);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [min, setMin] = useState("100");
  const [open, setOpen] = useState<string | null>(lists[0]?.id ?? null);

  const pool = fans.filter((f) => creatorId === "all" || f.creatorId === creatorId);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Listas inteligentes</h1>
        <p className="text-sm text-muted">Estas listas son de ejemplo local. Los destinatarios de un masivo salen de los fans sincronizados, en Campañas.</p>
      </div>
      <Panel title="Nueva lista por gasto">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            addList(name, Number(min) || 0);
            setName("");
            toast.success("Lista creada");
          }}
        >
          <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" required />
          <Field value={min} onChange={(e) => setMin(e.target.value)} inputMode="numeric" aria-label="Gasto mínimo 30 días" className="sm:w-40" />
          <Button type="submit">Crear</Button>
        </form>
      </Panel>
      <div className="grid gap-3 lg:grid-cols-2">
        {lists.map((list) => {
          const members = fansForList(pool, list);
          return (
            <article key={list.id} className="rounded-lg border border-line bg-surface">
              <button className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === list.id ? null : list.id)}>
                <span>
                  <span className="block text-sm font-medium">{list.name}</span>
                  <span className="block text-xs text-muted">{list.detail}</span>
                </span>
                <Badge tone="primary">{members.length}</Badge>
              </button>
              {open === list.id && (
                <ul className="border-t border-line">
                  {members.length === 0 && <li className="px-4 py-3 text-sm text-muted">Nadie cumple la regla ahora.</li>}
                  {members.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 last:border-0">
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{f.name}</span>
                        <span className="block text-xs text-muted">{creators.find((c) => c.id === f.creatorId)?.name} · ejemplo local</span>
                      </span>
                      <Button variant="ghost" onClick={() => { openFan(f.id); void navigate({ to: "/mensajes" }); }}>Chat</Button>
                    </li>
                  ))}
                  {list.custom && (
                    <li className="px-4 py-2">
                      <Button variant="danger" onClick={() => removeList(list.id)}>Eliminar lista</Button>
                    </li>
                  )}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function CampaignsPage() {
  const campaigns = useCrm((s) => s.campaigns);
  const lists = useCrm((s) => s.lists);
  const addCampaign = useCrm((s) => s.addCampaign);
  const setCampaignStatus = useCrm((s) => s.setCampaignStatus);
  const [name, setName] = useState("");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [body, setBody] = useState("");
  const [price, setPrice] = useState("");
  const [trigger, setTrigger] = useState("Manual");

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Mensajes inteligentes</h1>
        <div className="mt-3 flex gap-4 border-b border-line text-sm">
          <span className="border-b-2 border-primary pb-2 font-medium text-primary">Mensajes masivos</span>
          <span className="pb-2 text-muted">Mensajes automáticos</span>
        </div>
        <p className="mt-3 text-sm text-muted">La tabla antigua no son envíos de OnlyFans. El borrador de arriba usa los fans sincronizados.</p>
      </div>
      <CampaignDrafts />
      <Panel title="Nueva campaña">
        <form
          className="grid gap-2 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            addCampaign({
              name,
              listId,
              body,
              price: Number(price) || undefined,
              status: "programada",
              trigger,
            });
            setName("");
            setBody("");
            setPrice("");
            toast.success("Campaña programada");
          }}
        >
          <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" required />
          <Select value={listId} onChange={(e) => setListId(e.target.value)} aria-label="Lista">
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Select value={trigger} onChange={(e) => setTrigger(e.target.value)} aria-label="Disparador">
            {["Manual", "Nuevo suscriptor", "Expiración", "Compra", "Fan en línea"].map((t) => <option key={t}>{t}</option>)}
          </Select>
          <Field value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Precio base $" inputMode="numeric" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} required rows={3} placeholder="Hola {nombre}, tengo un set para ti" className="rounded-md border border-line bg-bg px-3 py-2 text-sm md:col-span-2" />
          <p className="text-xs text-muted md:col-span-2">{"{nombre}"} se cambia por el nombre de cada fan. Si el precio se parte en varios tramos, la app manda un masivo por tramo.</p>
          <Button type="submit">Guardar</Button>
        </form>
      </Panel>
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              {["Campaña", "Estado", "Fecha", "Lista", "Enviados", "Abiertos", "Masivos", "Ingresos", ""].map((h) => (
                <th key={h || "accion"} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const list = lists.find((l) => l.id === c.listId);
              const whenSent = "Sin enviar";
              return (
                <tr key={c.id} className="border-t border-line align-top">
                  <td className="px-3 py-3">
                    <p className="font-medium">{c.name}</p>
                    <p className="max-w-xs truncate text-xs text-muted">{c.body}</p>
                  </td>
                  <td className="px-3 py-3"><Badge tone={c.status === "enviada" ? "primary" : c.status === "pausada" ? "danger" : "gold"}>{c.status}</Badge></td>
                  <td className="px-3 py-3 text-xs">{whenSent}</td>
                  <td className="px-3 py-3">{list?.name ?? "—"}</td>
                  <td className="px-3 py-3 text-muted">—</td>
                  <td className="px-3 py-3 text-muted">—</td>
                  <td className="px-3 py-3 text-muted">—</td>
                  <td className="px-3 py-3 text-muted">Sin envío</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <Button disabled title="Envío real desactivado">Envío real desactivado</Button>
                      <Button variant="ghost" onClick={() => setCampaignStatus(c.id, c.status === "pausada" ? "activa" : "pausada")}>
                        {c.status === "pausada" ? "Reanudar" : "Pausar"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function VaultPage() {
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const teamAccess = useCrm((s) => s.teamAccess);
  const creator = creators.find((item) => item.id === creatorId) ?? null;
  if (!creator) {
    return <p className="p-6 text-sm text-[#6d7585]">Sin datos</p>;
  }
  return (
    <VaultBrowser
      creatorId={creator.id}
      creatorName={creator.name}
      fanName={null}
      fanKey={null}
      chatterId={teamAccess?.userId ?? null}
      messages={[]}
      onAttach={() => undefined}
    />
  );
}

export function ScriptsPage() {
  const scripts = useCrm((s) => s.scripts);
  const addScript = useCrm((s) => s.addScript);
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [storyline, setStoryline] = useState("Venta de set");
  const [text, setText] = useState("");
  const groups = [...new Set(scripts.map((s) => s.storyline))];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Guiones</h1>
        <p className="text-sm text-muted">Plantillas por historia. En el chat, escribe / y la palabra clave.</p>
      </div>
      <Panel title="Nuevo guion">
        <form
          className="grid gap-2 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            addScript({ title, keyword: keyword.replace(/\s/g, "").toLowerCase(), storyline, steps: [{ text }] });
            setTitle("");
            setKeyword("");
            setText("");
            toast.success("Guion guardado");
          }}
        >
          <Field value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" required />
          <Field value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="palabra clave" required />
          <Select value={storyline} onChange={(e) => setStoryline(e.target.value)} aria-label="Historia">
            {["Bienvenida", "Venta de set", "Renovación", "Reactivación"].map((g) => <option key={g}>{g}</option>)}
          </Select>
          <textarea value={text} onChange={(e) => setText(e.target.value)} required rows={3} placeholder="Primer mensaje del guion" className="rounded-md border border-line bg-bg px-3 py-2 text-sm md:col-span-3" />
          <Button type="submit">Guardar</Button>
        </form>
      </Panel>
      {groups.map((g) => (
        <section key={g}>
          <h2 className="mb-2 font-display text-sm font-semibold">{g}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {scripts.filter((s) => s.storyline === g).map((s) => (
              <article key={s.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{s.title}</p>
                  <Badge>/{s.keyword}</Badge>
                </div>
                <ol className="mt-3 space-y-2">
                  {s.steps.map((step, i) => (
                    <li key={step.text} className="text-sm text-muted">
                      <span className="text-fg">{i + 1}. </span>
                      {step.text}
                      {step.price ? <span className="text-gold"> · PPV {money(step.price)}</span> : null}
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function LinksPage() {
  const links = useCrm((s) => s.links);
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const rows = links.filter((l) => creatorId === "all" || l.creatorId === creatorId);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Enlaces de seguimiento</h1>
        <p className="text-sm text-muted">Ejemplo local. No son suscriptores ni ingresos de OnlyFans.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              {["Enlace", "Creadora", "Clics", "Subs", "Conversión", "Ingresos", "Código"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="px-3 py-3">{l.name}<div className="text-xs text-muted">{l.source}</div></td>
                <td className="px-3 py-3">{creators.find((c) => c.id === l.creatorId)?.name}</td>
                <td className="px-3 py-3 tabular-nums">{l.clicks}</td>
                <td className="px-3 py-3 tabular-nums">{l.subs}</td>
                <td className="px-3 py-3 tabular-nums">{pct(l.subs / Math.max(1, l.clicks))}</td>
                <td className="px-3 py-3 text-muted">Ejemplo</td>
                <td className="px-3 py-3">
                  <button
                    className="rounded-md bg-raised px-2 py-1 text-xs"
                    onClick={() => {
                      void navigator.clipboard?.writeText(l.code);
                      toast.success("Código copiado");
                    }}
                  >
                    {l.code}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AutomationsPage() {
  const automations = useCrm((s) => s.automations);
  const toggle = useCrm((s) => s.toggleAutomation);
  const update = useCrm((s) => s.updateAutomation);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Automatizaciones</h1>
        <p className="text-sm text-muted">Se disparan solas. No interrumpen un chat que ya está activo: el equipo revisa el tono aquí.</p>
      </div>
      <div className="space-y-3">
        {automations.map((a) => (
          <article key={a.id} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-muted">{a.trigger} · {a.delay}</p>
              </div>
              <button
                role="switch"
                aria-checked={a.enabled}
                onClick={() => toggle(a.id)}
                className={`relative h-6 w-11 rounded-full ${a.enabled ? "bg-primary" : "bg-line"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-fg ${a.enabled ? "left-5" : "left-0.5"}`} />
              </button>
            </div>
            <textarea
              value={a.body}
              onChange={(e) => update(a.id, e.target.value)}
              rows={2}
              className="mt-3 w-full resize-none rounded-md border border-line bg-bg px-3 py-2 text-sm"
            />
          </article>
        ))}
      </div>
    </div>
  );
}

export const PLATFORMS: Platform[] = ["OnlyFans", "Fansly", "Fanvue", "MYM"];
