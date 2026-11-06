import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bell,
  Clock,
  Image as ImageIcon,
  Lock,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Unlock,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { clock, timeAgo } from "@/lib/format";
import {
  adaptPrice,
  lastFanMessage,
  personalize,
  priceBand,
  suggestReplies,
  useCrm,
  type Fan,
  type Msg,
} from "@/lib/crm";
import { recordChatOutbound } from "@/lib/of-sessions";

const EMOJIS = ["😊", "⚙️", "🎁", "🔥", "💋", "❤️", "😏", "🍆", "💦", "😈", "😘", "🍑"];

const GLOSS: Record<string, string> = {
  "El set de estudio de la semana pasada me encantó. ¿Tienes algo nuevo en esa línea?": "I loved last week's studio set. Do you have something new in that line?",
  "Sí. Acabo de ordenar el set 08 en el vault, misma luz. Te lo dejo ahora.": "Yes. I just filed set 08 in the vault, same light. Sending it now.",
  "Desbloqueado. Gracias, este es el tono que quiero.": "Unlocked. Thanks, this is the tone I want.",
  "Hola, acabo de suscribirme desde TikTok.": "Hi, I just subscribed from TikTok.",
  "Bienvenido. Si me dices qué estilo te interesa, te preparo un set de entrada y no te mando de todo.": "Welcome. Tell me the style you like and I'll prepare a starter set, not everything at once.",
  "Polaroids de la sesión de tarde. Precio de entrada.": "Polaroids from the afternoon session. Entry price.",
  "Tu suscripción termina en dos días. Si renuevas te reservo el pack semanal.": "Your subscription ends in two days. Renew and I'll hold the weekly pack.",
  "Leo, el pack del viernes ya está. Te lo dejo antes de la lista general.": "Leo, Friday's pack is ready. I'm sending it before the general list.",
  "Lo miro esta noche. No dejes que expire la reserva.": "I'll look tonight. Don't let the hold expire.",
  "Hace unos días que no estás. Si vuelves, el hilo sigue donde lo dejamos.": "You've been away a few days. If you come back, the thread is where we left it.",
  "Gracias por suscribirte. Cuéntame qué estilo te interesa y te oriento.": "Thanks for subscribing. Tell me the style you want and I'll guide you.",
  "¿Sigue disponible el set de anoche?": "Is last night's set still available?",
  "Sí. Te lo dejo otra vez, mismo precio.": "Yes. Sending it again, same price.",
  "Set premium de la semana, antes de la campaña.": "This week's premium set, before the campaign.",
  "Hecho. Prepara el siguiente cuando esté.": "Done. Prepare the next one when it's ready.",
  "Serie corta de la costa. Si te encaja el tono seguimos.": "Short coastal series. If the tone fits, we continue.",
  "Hace tiempo que no compras nada. Te dejo un set corto, sin presión.": "You haven't bought anything in a while. Here's a short set, no pressure.",
  "De momento me quedo con el feed, gracias.": "I'll stick with the feed for now, thanks.",
};

function eur(n: number) {
  return `$${n.toFixed(2)}`;
}

function when(ts: number) {
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) return clock(ts);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function gloss(text: string) {
  return GLOSS[text];
}

type Chip = "todos" | "prioridad" | "propina" | "renovar";

export function MessagesPage() {
  const fans = useCrm((s) => s.fans);
  const messages = useCrm((s) => s.messages);
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const query = useCrm((s) => s.query);
  const fanId = useCrm((s) => s.fanId);
  const openFan = useCrm((s) => s.openFan);
  const closeFan = useCrm((s) => s.closeFan);
  const drafts = useCrm((s) => s.drafts);
  const setDraft = useCrm((s) => s.setDraft);
  const sendMessage = useCrm((s) => s.sendMessage);
  const unlockPpv = useCrm((s) => s.unlockPpv);
  const fanReply = useCrm((s) => s.fanReply);
  const saveNote = useCrm((s) => s.saveNote);
  const scripts = useCrm((s) => s.scripts);
  const vault = useCrm((s) => s.vault);
  const attachVaultId = useCrm((s) => s.attachVaultId);
  const setAttach = useCrm((s) => s.setAttach);
  const copilot = useCrm((s) => s.copilot);
  const adaptPrices = useCrm((s) => s.adaptPrices);
  const translate = useCrm((s) => s.translate);
  const employees = useCrm((s) => s.employees);
  const activeEmployeeId = useCrm((s) => s.activeEmployeeId);
  const [price, setPrice] = useState("");
  const [showScripts, setShowScripts] = useState(false);
  const [insights, setInsights] = useState(false);
  const [panel, setPanel] = useState<"ficha" | "ventas" | "notas">("ficha");
  const [chip, setChip] = useState<Chip>("prioridad");
  const [onlineOnly, setOnlineOnly] = useState(true);
  const [alerts, setAlerts] = useState(false);
  const [searching, setSearching] = useState(false);
  const [localQuery, setLocalQuery] = useState("");

  const employee = employees.find((e) => e.id === activeEmployeeId);
  const teamAccess = useCrm((s) => s.teamAccess);
  const canPrice = teamAccess?.role === "owner" || teamAccess?.perms.includes("precios") === true;
  const canSend = teamAccess?.role === "owner" || teamAccess?.perms.includes("mensajes") === true;
  const creator = creators.find((c) => c.id === creatorId) ?? creators[0];

  const visible = useMemo(() => {
    const q = (localQuery || query).trim().toLowerCase();
    return fans
      .filter((f) => creatorId === "all" || f.creatorId === creatorId)
      .filter((f) => chip === "renovar" || !onlineOnly || f.online)
      .filter((f) => !alerts || f.unread > 0)
      .filter((f) => {
        if (chip === "prioridad") return f.tier === "ballena" || f.status === "renovacion" || f.unread > 0 || f.online;
        if (chip === "propina") return messages.some((m) => m.fanId === f.id && m.tip);
        if (chip === "renovar") return f.status === "renovacion" || f.status === "expirado";
        return true;
      })
      .filter((f) => !q || f.name.toLowerCase().includes(q) || f.handle.toLowerCase().includes(q))
      .sort((a, b) => (lastFanMessage(messages, b.id)?.at ?? 0) - (lastFanMessage(messages, a.id)?.at ?? 0));
  }, [fans, creatorId, chip, onlineOnly, alerts, localQuery, query, messages]);

  const fan = fans.find((f) => f.id === fanId) ?? null;
  const thread = messages.filter((m) => m.fanId === fan?.id && !m.unsent);
  const draft = fan ? (drafts[fan.id] ?? "") : "";
  const suggestions = suggestReplies(fan ?? undefined, copilot);
  const attached = vault.find((v) => v.id === attachVaultId);
  const basePrice = Number(price) || 0;
  const quote = fan && basePrice > 0 && adaptPrices !== false ? adaptPrice(basePrice, fan) : null;
  const slash = draft.startsWith("/") ? draft.slice(1).toLowerCase() : null;
  const slashHits = slash !== null ? scripts.filter((s) => s.keyword.includes(slash) || s.title.toLowerCase().includes(slash)) : [];
  const pendingPpv = [...thread].reverse().find((m) => m.from === "team" && m.ppv && !m.ppv.unlocked && m.status === "enviado");

  useEffect(() => {
    if (!attachVaultId) return;
    const item = vault.find((v) => v.id === attachVaultId);
    if (item) setPrice(String(item.price));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachVaultId]);

  useEffect(() => {
    if (fanId || !visible[0]) return;
    if (window.matchMedia("(min-width: 768px)").matches) openFan(visible[0].id);
  }, [fanId, visible, openFan]);

  function deliver(text: string) {
    if (!fan || !canSend) return;
    const result = sendMessage({
      fanId: fan.id,
      text,
      price: Number(price) || undefined,
      vaultId: attachVaultId ?? undefined,
    });
    if (!result.ok) toast.error(result.reason);
    else {
      const body = personalize(text.trim(), fan) || "Contenido";
      void recordChatOutbound({
        data: {
          creatorId: fan.creatorId,
          fanKey: fan.id,
          threadKey: fan.id,
          body,
          priceCents: result.price != null ? Math.round(result.price * 100) : null,
          ofMessageKey: null,
        },
      }).catch(() => undefined);
      if (result.price) toast.success(`PPV enviado a ${eur(result.price)}`);
      else toast.success("Mensaje entregado");
    }
    setPrice("");
    setShowScripts(false);
  }

  return (
    <div className="flex h-full min-h-0 bg-white text-[#1c2333]">
      <section className={cn("flex w-full min-w-0 flex-col border-r border-[#e6e8ee] md:w-[340px]", fan && "hidden md:flex")}>
        <div className="flex items-center gap-2 px-4 py-3">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{creatorId === "all" ? "Todas las cuentas" : creator?.name}</h1>
          <button className="text-[#6d7585]" aria-label="Bóveda" onClick={() => toast("El vault se abre desde el menú de crecimiento")}><ImageIcon className="h-4 w-4" /></button>
          <button className="text-[#6d7585]" aria-label="Buscar" onClick={() => setSearching((v) => !v)}><Search className="h-4 w-4" /></button>
          <button className="text-[#6d7585]" aria-label="Nuevo" onClick={() => toast("Las cuentas nuevas se añaden en Creadoras")}><Plus className="h-4 w-4" /></button>
        </div>
        {searching && (
          <input
            autoFocus
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            placeholder="Buscar fan"
            className="mx-4 mb-2 rounded-lg border border-[#e6e8ee] px-3 py-2 text-sm"
          />
        )}
        <div className="grid grid-cols-2 gap-2 px-4">
          <button onClick={() => setOnlineOnly((v) => !v)} className={cn("flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium text-white", onlineOnly ? "bg-[#3b6cff]" : "bg-[#3b6cff]/40")}>
            <span className="grid h-4 w-4 place-items-center rounded-full border border-white text-[10px]">•</span>
            Fans en línea
          </button>
          <button onClick={() => setAlerts((v) => !v)} className={cn("flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium text-white", alerts ? "bg-[#2fbf8f]" : "bg-[#2fbf8f]/70")}>
            <Bell className="h-4 w-4" />
            Avisos
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 px-4 text-xs text-[#6d7585]">
          <span className="rounded-lg border border-[#e6e8ee] px-2 py-1">Todas las bandejas</span>
          <span>Más recientes</span>
        </div>
        <div className="mt-2 flex items-center gap-2 overflow-x-auto px-4 pb-2">
          {([
            ["todos", "Todas"],
            ["prioridad", "Prioridad"],
            ["renovar", "Por renovar"],
            ["propina", "Con propina"],
          ] as const).map(([id, label]) => (
            <button key={id} onClick={() => setChip(id)} className={cn("rounded-full px-3 py-1 text-xs", chip === id ? "bg-[#3b6cff] text-white" : "bg-[#f3f4f6] text-[#1c2333]")}>
              {label}
            </button>
          ))}
        </div>
        <ul className="min-h-0 flex-1 overflow-auto">
          {visible.length === 0 && <li className="p-4 text-sm text-[#6d7585]">Ningún fan en esta vista.</li>}
          {visible.map((f) => {
            const threadForFan = messages.filter((m) => m.fanId === f.id && !m.unsent);
            const last = threadForFan[threadForFan.length - 1];
            const pending = threadForFan.some((m) => m.from === "team" && m.ppv && !m.ppv.unlocked && m.status === "enviado");
            const renew = f.status === "renovacion" || f.status === "expirado";
            const who = last?.from === "team" ? last.author.split(" ")[0] : null;
            const active = f.id === fanId;
            return (
              <li key={f.id}>
                <button onClick={() => openFan(f.id)} className={cn("flex w-full gap-3 px-4 py-3 text-left", active && "bg-[#eef2ff]")}>
                  <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#eceff3] text-sm font-semibold">
                    {f.status === "nuevo" ? <span className="text-[10px] font-bold text-[#16a34a]">NEW</span> : f.name.slice(0, 1)}
                    <span className={cn("absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-1 text-[9px] font-semibold text-white", f.spendLife > 0 ? "bg-[#16a34a]" : "bg-[#f59e0b]")}>
                      {eur(f.spendLife)}
                    </span>
                    {f.online && <span className="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#22c55e]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1">
                      <span className="truncate text-sm font-semibold">{f.name}</span>
                      <span className="truncate text-xs text-[#98a0ae]">{f.handle}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      {pending && <span className="rounded-full bg-[#fff6e8] px-1.5 py-0.5 text-[10px] font-medium text-[#8a5a12]">PPV sin abrir</span>}
                      {renew && <span className="rounded-full bg-[#eef2ff] px-1.5 py-0.5 text-[10px] font-medium text-[#2456c7]">Renovar</span>}
                    </span>
                    <span className="block truncate text-xs text-[#6d7585]">{who ? `${who}: ` : ""}{last?.text ?? "Sin mensajes"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-[#98a0ae]">{last ? when(last.at) : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={cn("min-w-0 flex-1 flex-col bg-white", fan ? "flex" : "hidden md:flex")}>
        {!fan ? (
          <div className="grid flex-1 place-items-center text-sm text-[#6d7585]">Elige un fan.</div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b border-[#e6e8ee] px-3 py-2">
              <button className="md:hidden" onClick={() => closeFan()} aria-label="Volver"><ArrowLeft className="h-4 w-4" /></button>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-semibold">
                  {fan.name}
                  <Pencil className="h-3.5 w-3.5 text-[#98a0ae]" />
                </p>
                <p className="text-xs text-[#6d7585]">{fan.online ? "Disponible ahora" : `Visto ${timeAgo(lastFanMessage(messages, fan.id)?.at ?? Date.now())}`}</p>
              </div>
              <Star className="h-4 w-4 text-[#98a0ae]" />
              <button className="text-xs text-[#3b6cff]" onClick={() => fanReply(fan.id)}>El fan responde</button>
              <button className="text-xs font-medium text-[#3b6cff]" onClick={() => setInsights(true)}>Ficha</button>
            </header>
            <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
              {thread.map((m) => (
                <Bubble key={m.id} message={m} showTranslation={translate !== false} onUnlock={() => unlockPpv(m.id)} />
              ))}
            </div>
            <footer className="border-t border-[#eef0f4] px-3 py-2">
              {pendingPpv?.ppv && (
                <button
                  className="mb-2 w-full rounded-lg bg-[#fff6e8] px-3 py-2 text-left text-xs text-[#8a5a12]"
                  onClick={() => setDraft(fan.id, `{nombre}, el set sigue aquí si lo quieres ver. Si no encaja, lo dejo.`)}
                >
                  No ha abierto {pendingPpv.ppv.title} · {eur(pendingPpv.ppv.price)}. Preparar seguimiento.
                </button>
              )}
              {(fan.status === "renovacion" || fan.status === "expirado") && (
                <button
                  className="mb-2 w-full rounded-lg bg-[#eef2ff] px-3 py-2 text-left text-xs text-[#2456c7]"
                  onClick={() => setDraft(fan.id, fan.status === "expirado"
                    ? "{nombre}, tu suscripción terminó. Si vuelves hoy te dejo el pack de la semana antes que al resto."
                    : "{nombre}, tu suscripción está a punto de terminar. Si renuevas hoy te reservo el pack.")}
                >
                  {fan.status === "expirado" ? "Recuperar suscripción" : "Avisar de la renovación"}
                </button>
              )}
              {(slash !== null && slashHits.length > 0) || showScripts ? (
                <ul className="mb-2 max-h-36 overflow-auto rounded-lg border border-[#e6e8ee]">
                  {(slash !== null ? slashHits : scripts).map((s) => (
                    <li key={s.id}>
                      <button
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-[#f6f7f9]"
                        onClick={() => {
                          const step = s.steps[0];
                          if (!step) return;
                          setDraft(fan.id, step.text);
                          if (step.price && canPrice) setPrice(String(step.price));
                          if (step.vaultId) setAttach(step.vaultId);
                          setShowScripts(false);
                        }}
                      >
                        /{s.keyword} · {s.title}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {copilot && suggestions.length > 0 && (
                <div className="mb-2 flex gap-2 overflow-x-auto">
                  {suggestions.map((s) => (
                    <button key={s} className="shrink-0 rounded-full bg-[#f3f4f6] px-2 py-1 text-xs text-[#4b5568]" onClick={() => setDraft(fan.id, s)}>
                      {s.slice(0, 64)}…
                    </button>
                  ))}
                </div>
              )}
              <div className="mb-1 flex items-center gap-2">
                <div className="flex gap-1 overflow-x-auto text-base">
                  {EMOJIS.map((emoji) => (
                    <button key={emoji} onClick={() => setDraft(fan.id, `${draft}${emoji}`)} className="px-0.5">{emoji}</button>
                  ))}
                </div>
                <button className="ml-auto flex items-center gap-1 rounded-lg border border-[#d9e2ff] px-2 py-1 text-xs text-[#3b6cff]" onClick={() => setShowScripts((v) => !v)}>
                  <Sparkles className="h-3.5 w-3.5" /> Guiones
                </button>
                <Clock className="h-4 w-4 text-[#98a0ae]" />
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(fan.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (canSend && (draft.trim() || price)) deliver(draft);
                  }
                }}
                rows={2}
                disabled={!canSend}
                placeholder={'Pulsa "/" y una palabra para buscar un guion'}
                className="w-full resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-[#b0b6c2]"
              />
              {quote && (
                <p className="px-1 text-xs text-[#c4841d]">Este fan lo recibe a {eur(quote.price)} · {quote.label}</p>
              )}
              {draft.includes("{") && <p className="px-1 text-xs text-[#6d7585]">Verá: {personalize(draft, fan)}</p>}
              <div className="flex items-center gap-3 text-[#98a0ae]">
                <button aria-label="Adjuntar vault" onClick={() => setShowScripts(true)}><ImageIcon className="h-4 w-4" /></button>
                {canPrice && (
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    inputMode="numeric"
                    placeholder="PPV $"
                    aria-label="Precio base del PPV"
                    className="w-16 rounded-md border border-[#e6e8ee] px-2 py-1 text-xs text-[#1c2333]"
                  />
                )}
                {attached && (
                  <button className="rounded-full bg-[#f3f4f6] px-2 py-1 text-xs text-[#1c2333]" onClick={() => setAttach(null)}>
                    {attached.title} <X className="inline h-3 w-3" />
                  </button>
                )}
                <button className="text-xs" onClick={() => setDraft(fan.id, `${draft}{nombre}`)}>@</button>
                <button
                  disabled={!canSend}
                  onClick={() => deliver(draft)}
                  className="ml-auto rounded-full bg-[#5b7cfa] px-5 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {quote ? eur(quote.price) : "Enviar"}
                </button>
              </div>
            </footer>
          </>
        )}
      </section>

      {insights && fan && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setInsights(false)}>
          <div
            className="flex h-[min(640px,90vh)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <FanInsights fan={fan} messages={messages} panel={panel} setPanel={setPanel} onClose={() => setInsights(false)} saveNote={saveNote} />
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({ message, showTranslation, onUnlock }: { message: Msg; showTranslation: boolean; onUnlock: () => void }) {
  const mine = message.from === "team";
  const translation = gloss(message.text);
  return (
    <article className={cn("flex max-w-lg items-end gap-2", mine && "ml-auto flex-row-reverse")}>
      {mine && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eceff3] text-xs">F</span>}
      <div>
        <div className={cn("rounded-2xl px-3 py-2 text-sm", mine ? "bg-[#e7eeff]" : "bg-[#f2f3f5]", message.status === "retenido" && "bg-red-50")}>
          <p>{message.text}</p>
          {showTranslation && translation && (
            <p className="mt-1 rounded-xl bg-white px-2 py-1 text-[13px] text-[#3c4454]">{translation}</p>
          )}
          {message.ppv && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-white px-2 py-1.5 text-xs">
              <span className="flex items-center gap-1">
                {message.ppv.unlocked ? <Unlock className="h-3.5 w-3.5 text-[#16a34a]" /> : <Lock className="h-3.5 w-3.5" />}
                {message.ppv.title} · {eur(message.ppv.price)}
              </span>
              {!message.ppv.unlocked && message.status === "enviado" && (
                <button className="text-[#3b6cff]" onClick={onUnlock}>Desbloquear</button>
              )}
            </div>
          )}
          {message.tip ? <p className="mt-1 text-xs text-[#c4841d]">Propina {eur(message.tip)}</p> : null}
          {message.status === "retenido" && <p className="mt-1 text-xs text-red-600">Retenido · {message.flag}</p>}
        </div>
        <p className="mt-1 text-[11px] text-[#98a0ae]">
          {clock(message.at)} {mine ? message.author : ""} {message.mass ? "· masivo" : ""}
        </p>
      </div>
    </article>
  );
}

function threadSummary(fan: Fan, messages: Msg[]) {
  const thread = messages.filter((m) => m.fanId === fan.id && !m.unsent);
  const last = thread[thread.length - 1];
  const openPpv = thread.some((m) => m.from === "team" && m.ppv && !m.ppv.unlocked);
  const buys = fan.spend30 > 0 ? `Este mes lleva ${eur(fan.spend30)}.` : "Este mes no ha comprado.";
  const state = fan.status === "expirado" ? "La suscripción está caída." : fan.status === "renovacion" ? "La suscripción está por renovar." : fan.online ? "Está en línea." : "No está en línea.";
  const lastLine = last ? `Lo último: «${last.text.slice(0, 90)}».` : "Todavía no hay mensajes.";
  return `${fan.name.split(" ")[0]} es ${fan.tier}. ${buys} ${state} ${openPpv ? "Tiene un PPV sin abrir." : ""} ${lastLine}`.replace(/\s+/g, " ").trim();
}

function FanInsights({
  fan,
  messages,
  panel,
  setPanel,
  onClose,
  saveNote,
}: {
  fan: Fan;
  messages: Msg[];
  panel: "ficha" | "ventas" | "notas";
  setPanel: (p: "ficha" | "ventas" | "notas") => void;
  onClose: () => void;
  saveNote: (id: string, notes: string) => void;
}) {
  const [notes, setNotes] = useState(fan.notes);
  const band = priceBand(fan);
  const mine = messages.filter((m) => m.fanId === fan.id && !m.unsent && m.status === "enviado");
  const ppv = mine.filter((m) => m.ppv?.unlocked);
  const tips = mine.filter((m) => m.tip);
  const ppvTotal = ppv.reduce((s, m) => s + (m.ppv?.price ?? 0), 0);
  const tipTotal = tips.reduce((s, m) => s + (m.tip ?? 0), 0);
  const highest = Math.max(0, ...ppv.map((m) => m.ppv?.price ?? 0), ...tips.map((m) => m.tip ?? 0));
  const last = [...ppv, ...tips].sort((a, b) => b.at - a.at)[0];
  const power = fan.tier === "ballena" ? "Top 5%" : fan.tier === "gastador" ? "Top 20%" : fan.spendLife < 50 ? "Datos insuficientes" : "Medio";
  const sub = fan.tier === "ballena" ? 14.99 : fan.tier === "gastador" ? 9.99 : 5.4;
  const months = Math.max(1, Math.round(fan.days / 30));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="font-semibold">Ficha del fan</p>
        <button className="text-xs text-[#6d7585]" onClick={onClose}>Cerrar</button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 pb-3">
        <Card title="Resumen del hilo">
          <p className="text-sm text-[#3c4454]">{threadSummary(fan, messages)}</p>
        </Card>
        {panel === "ficha" && (
          <>
            <Card title="Comportamiento de gasto">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Gasto total" value={eur(fan.spendLife)} />
                <Stat label="Último gasto" value={last ? timeAgo(last.at) : "—"} hint={last?.ppv ? `PPV ${eur(last.ppv.price)}` : undefined} />
              </div>
              <Row label="PPV" value={`${eur(ppvTotal)} total`} hint={ppv.length ? `${eur(ppvTotal / ppv.length)} media` : "— media"} />
              <Row label="Propina" value={`${eur(tipTotal)} total`} hint={tips.length ? `${eur(tipTotal / tips.length)} media` : "— media"} />
              <Row label="Gasto más alto" value={highest ? eur(highest) : "—"} />
            </Card>
            <Card title="Métricas">
              <Row label="Poder de gasto" value={power} />
              <Row label="Riesgo de contracargo" value={fan.tags.includes("riesgo") ? "Medio" : "Bajo"} />
              <Row label="Precio PPV" value={`${band.label} ×${band.factor.toLocaleString("es-ES")}`} />
            </Card>
            <Card title="Suscripción">
              <Row label="Estado" value={fan.status === "activo" || fan.status === "nuevo" ? "Activa" : fan.status === "expirado" ? "Expirada" : "Renovación"} />
              <Row label="Coste" value={`${eur(sub)} / mes`} />
              <Row label="Duración" value={`${months} ${months === 1 ? "mes" : "meses"}`} />
              <Row label="Auto-renovación" value={fan.status === "expirado" ? "No" : "Sí"} />
            </Card>
          </>
        )}
        {panel === "ventas" && (
          <Card title="Ventas">
            {ppv.length + tips.length === 0 && <p className="text-sm text-[#6d7585]">Todavía no hay compras.</p>}
            {[...ppv, ...tips].map((m) => (
              <Row key={m.id} label={m.ppv?.title ?? "Propina"} value={eur(m.tip ?? m.ppv?.price ?? 0)} />
            ))}
          </Card>
        )}
        {panel === "notas" && (
          <Card title="Notas">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => saveNote(fan.id, notes)}
              rows={6}
              className="w-full resize-none rounded-lg border border-[#e6e8ee] bg-white px-2 py-2 text-sm"
            />
          </Card>
        )}
      </div>
      <div className="grid grid-cols-3 border-t border-[#e6e8ee] bg-white text-center text-xs">
        {([
          ["ficha", "Ficha"],
          ["ventas", "Ventas"],
          ["notas", "Notas"],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setPanel(id)} className={cn("py-3", panel === id ? "text-[#1c2333]" : "text-[#98a0ae]")}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#e6e8ee] bg-white p-3">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-[#6d7585]">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-[#98a0ae]">{hint}</p>}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-[#6d7585]">{label}</span>
      <span className="text-right">
        <span className="block font-medium">{value}</span>
        {hint && <span className="block text-xs text-[#98a0ae]">{hint}</span>}
      </span>
    </div>
  );
}
