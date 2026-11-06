import { create } from "zustand";
import { isLast24h } from "@/lib/format";
import { defaultDashboardConfig, normalizeDashboardConfig, type DashboardConfig } from "@/lib/dashboard-config";

export type Platform = "OnlyFans" | "Fansly" | "Fanvue" | "MYM";
export type Tier = "ballena" | "gastador" | "nuevo" | "frio";
export type FanStatus = "activo" | "nuevo" | "expirado" | "renovacion";
export type Role = "Dueña" | "Manager" | "Chatter" | "VA";
export type Perm =
  | "mensajes"
  | "precios"
  | "vault"
  | "campanas"
  | "analitica"
  | "equipo"
  | "ajustes";

export type Creator = {
  id: string;
  name: string;
  handle: string;
  platform: Platform;
  city: string;
  subscribers: number;
  revenue30: number | null;
  growth: number;
  split: number;
  status: "activa" | "pausa";
  hue: number;
  proxy: string;
  nick?: string;
  tag?: string;
  staff?: string[];
};

export type Fan = {
  id: string;
  creatorId: string;
  name: string;
  handle: string;
  spendLife: number;
  spend30: number;
  days: number;
  status: FanStatus;
  tier: Tier;
  online: boolean;
  notes: string;
  tags: string[];
  city: string;
  unread: number;
};

export type Msg = {
  id: string;
  fanId: string;
  creatorId: string;
  from: "fan" | "team";
  author: string;
  text: string;
  at: number;
  creditedTo?: string;
  ppv?: { title: string; price: number; base?: number; band?: string; unlocked: boolean; vaultId?: string };
  tip?: number;
  unsent?: boolean;
  mass?: boolean;
  campaignId?: string;
  status: "enviado" | "retenido";
  flag?: string;
};

export type VaultItem = {
  id: string;
  creatorId: string;
  folder: string;
  title: string;
  kind: "foto" | "video" | "set";
  price: number;
  sent: number;
  unlocks: number;
  revenue: number;
  hue: number;
};

export type ScriptStep = { text: string; price?: number; vaultId?: string };
export type Script = {
  id: string;
  storyline: string;
  title: string;
  keyword: string;
  steps: ScriptStep[];
};

export type SmartList = {
  id: string;
  name: string;
  detail: string;
  kind: "ballenas" | "nuevos" | "riesgo" | "online" | "sincompra" | "custom";
  minSpend: number;
  custom?: boolean;
};

export type Campaign = {
  id: string;
  name: string;
  listId: string;
  body: string;
  price?: number;
  status: "activa" | "programada" | "pausada" | "enviada";
  sent: number;
  earned: number;
  trigger: string;
  sentAt?: number;
  opened?: number;
  lastBatches?: { price: number; band: string; fans: number }[];
};

export type Employee = {
  id: string;
  name: string;
  role: Role;
  replyMin: number | null;
  online: boolean;
  perms: Perm[];
  shifts: Array<"mañana" | "noche" | "libre">;
};

export type TrackLink = {
  id: string;
  name: string;
  source: string;
  creatorId: string;
  clicks: number;
  subs: number;
  revenue: number;
  code: string;
};

export type Automation = {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  body: string;
  delay: string;
};

export type InboxTab = "todos" | "prioridad" | "ballenas" | "nuevos" | "sinleer" | "online";

const ago = (hours: number) => Date.now() - hours * 3600 * 1000;

const ALL_PERMS: Perm[] = [
  "mensajes",
  "precios",
  "vault",
  "campanas",
  "analitica",
  "equipo",
  "ajustes",
];

export const PERM_LABELS: { id: Perm; label: string }[] = [
  { id: "mensajes", label: "Mensajes" },
  { id: "precios", label: "Precios PPV" },
  { id: "vault", label: "Vault" },
  { id: "campanas", label: "Campañas" },
  { id: "analitica", label: "Analítica" },
  { id: "equipo", label: "Equipo" },
  { id: "ajustes", label: "Ajustes" },
];

function freshData() {
  const employees: Employee[] = [
    {
      id: "e-yo",
      name: "Tú",
      role: "Dueña",
      replyMin: 0,
      online: true,
      perms: ALL_PERMS,
      shifts: ["libre", "libre", "libre", "libre", "libre", "libre", "libre"],
    },
  ];

  const lists: SmartList[] = [
    { id: "l-ballenas", name: "Ballenas", detail: "Gasto de vida ≥ $500.00", kind: "ballenas", minSpend: 500 },
    { id: "l-nuevos", name: "Nuevos 7 días", detail: "Suscripción de 7 días o menos", kind: "nuevos", minSpend: 0 },
    { id: "l-riesgo", name: "En riesgo", detail: "Renovación o ya expirados", kind: "riesgo", minSpend: 0 },
    { id: "l-online", name: "En línea ahora", detail: "Conectados en este momento", kind: "online", minSpend: 0 },
    { id: "l-frio", name: "Sin compra 30 días", detail: "Activos con $0.00 este mes", kind: "sincompra", minSpend: 0 },
  ];

  return {
    agency: "Fanlink Management",
    creators: [] as Creator[],
    fans: [] as Fan[],
    messages: [] as Msg[],
    vault: [] as VaultItem[],
    scripts: [] as Script[],
    lists,
    campaigns: [] as Campaign[],
    employees,
    links: [] as TrackLink[],
    automations: [] as Automation[],
    history: [] as { day: string; euros: number }[],
    stopWords: ["telegram", "whatsapp", "paypal", "menor", "encuentros", "gratis total"],
    copilot: true,
    translate: true,
    adaptPrices: true,
    notifyShifts: true,
    dashboardConfig: defaultDashboardConfig(),
    creatorId: "all" as string,
    fanId: null as string | null,
    inboxTab: "todos" as InboxTab,
    query: "",
    activeEmployeeId: "e-yo",
    drafts: {} as Record<string, string>,
    attachVaultId: null as string | null,
  };
}

export type DataSlice = ReturnType<typeof freshData>;

type CrmState = DataSlice & {
  setCreator: (id: string) => void;
  setTab: (tab: InboxTab) => void;
  setQuery: (q: string) => void;
  setEmployee: (id: string) => void;
  openFan: (id: string) => void;
  closeFan: () => void;
  setDraft: (fanId: string, text: string) => void;
  setAttach: (id: string | null) => void;
  sendMessage: (input: { fanId: string; text: string; price?: number; vaultId?: string; mass?: boolean; campaignId?: string }) => { ok: boolean; reason?: string; price?: number };
  unlockPpv: (messageId: string) => void;
  unsend: (messageId: string) => void;
  fanReply: (fanId: string) => void;
  saveNote: (fanId: string, notes: string) => void;
  addList: (name: string, minSpend: number) => void;
  removeList: (id: string) => void;
  addCampaign: (c: Omit<Campaign, "id" | "sent" | "earned">) => void;
  sendCampaign: (id: string) => number;
  duplicateCampaign: (id: string) => void;
  setCampaignStatus: (id: string, status: Campaign["status"]) => void;
  addScript: (s: Omit<Script, "id">) => void;
  toggleAutomation: (id: string) => void;
  updateAutomation: (id: string, body: string) => void;
  togglePerm: (employeeId: string, perm: Perm) => void;
  cycleShift: (employeeId: string, day: number) => void;
  addEmployee: (name: string, role: Role) => void;
  addCreator: (input: { name: string; nick: string; handle: string; platform: Platform; city: string; tag: string }) => void;
  addStopWord: (word: string) => void;
  removeStopWord: (word: string) => void;
  setCopilot: (on: boolean) => void;
  setTranslate: (on: boolean) => void;
  setAdaptPrices: (on: boolean) => void;
  setNotify: (on: boolean) => void;
  setAgency: (name: string) => void;
  setDashboardConfig: (config: DashboardConfig) => void;
  resetDemo: () => void;
  workspaceReady: boolean;
  workspaceNotice: string | null;
  teamAccess: {
    userId: string;
    role: "owner" | "member";
    perms: string[];
    creatorIds: string[];
    displayName: string;
    devMode: boolean;
  } | null;
};

const uid = () => Math.random().toString(36).slice(2, 9);

const REPLIES = [
  "Me interesa, mándame los detalles.",
  "¿Qué incluye el set?",
  "Luego lo veo, gracias.",
  "Perfecto, lo miro ahora.",
  "¿Tienes una opción más corta?",
];

export function messageValue(m: Msg) {
  if (m.unsent || m.status === "retenido") return 0;
  return (m.tip ?? 0) + (m.ppv?.unlocked ? m.ppv.price : 0);
}

export function priceBand(fan: Fan): { label: string; factor: number } {
  if (fan.spend30 >= 500 || fan.spendLife >= 1800) return { label: "Máximo gasto", factor: 1.55 };
  if (fan.spend30 >= 200 || fan.spendLife >= 700) return { label: "Compra mucho", factor: 1.3 };
  if (fan.spend30 === 0 && fan.spendLife < 100) return { label: "Sin compras", factor: 0.55 };
  if (fan.spend30 === 0) return { label: "Sin compra este mes", factor: 0.7 };
  if (fan.spend30 < 50) return { label: "Compra poco", factor: 0.8 };
  return { label: "Gasto medio", factor: 1 };
}

export function adaptPrice(base: number, fan: Fan) {
  const band = priceBand(fan);
  const price = Math.max(3, Math.round(base * band.factor));
  return { ...band, base, price };
}

export function personalize(text: string, fan: Fan) {
  const first = fan.name.split(" ")[0] || fan.name;
  return text
    .replaceAll("{nombre}", first)
    .replaceAll("{nombrecompleto}", fan.name)
    .replaceAll("{usuario}", fan.handle);
}

export function massPlan(fans: Fan[], base: number | undefined, adapt: boolean) {
  if (!fans.length) return [];
  if (!base || base <= 0) return [{ price: 0, band: "Sin PPV", fans: fans.length }];
  const groups = new Map<number, { price: number; band: string; fans: number }>();
  for (const fan of fans) {
    const quote = adapt ? adaptPrice(base, fan) : { price: base, label: "Precio fijo" };
    const row = groups.get(quote.price);
    if (row) row.fans += 1;
    else groups.set(quote.price, { price: quote.price, band: quote.label, fans: 1 });
  }
  return [...groups.values()].sort((a, b) => a.price - b.price);
}

export function fansForList(fans: Fan[], list: SmartList) {
  switch (list.kind) {
    case "ballenas":
      return fans.filter((f) => f.spendLife >= 500 && f.status !== "expirado");
    case "nuevos":
      return fans.filter((f) => f.days <= 7 && f.status !== "expirado");
    case "riesgo":
      return fans.filter((f) => f.status === "renovacion" || f.status === "expirado");
    case "online":
      return fans.filter((f) => f.online);
    case "sincompra":
      return fans.filter((f) => f.spend30 === 0 && (f.status === "activo" || f.status === "nuevo"));
    default:
      return fans.filter((f) => f.spend30 >= list.minSpend);
  }
}

export function suggestReplies(fan: Fan | undefined, copilot: boolean) {
  if (!copilot || !fan) return [];
  if (fan.status === "renovacion" || fan.status === "expirado") {
    return [
      "Tu suscripción está a punto de terminar. Si renuevas hoy te reservo el pack de la semana.",
      "No quiero perder el hilo: dime si sigues y te dejo el set antes que al resto.",
      "Puedo pausar los mensajes automáticos y escribirte solo cuando haya algo de tu estilo.",
    ];
  }
  if (fan.tier === "ballena") {
    return [
      "He visto que te gusta el contenido de estudio. Tengo un set nuevo de esta semana, ¿te lo dejo a tu precio habitual?",
      "Antes de la campaña general te reservo el pack. Si no te encaja, no lo mando.",
      "Gracias por el apoyo constante. El siguiente set sigue exactamente esa línea.",
    ];
  }
  if (fan.tier === "nuevo" || fan.status === "nuevo") {
    return [
      "Bienvenido. Si me dices qué estilo te interesa, te preparo algo a medida.",
      "Para no saturarte: ¿prefieres sets cortos o la línea larga de la cuenta?",
      "Puedo dejarte un set de entrada y, si encaja, seguimos.",
    ];
  }
  if (fan.tier === "frio") {
    return [
      "Hace tiempo que no hablamos. Tengo un set corto, sin presión.",
      "Si el feed te basta, lo dejo aquí. Si quieres algo concreto, dímelo.",
      "He separado una pieza breve por si quieres retomar.",
    ];
  }
  return [
    "Te he visto conectado. ¿Quieres que te enseñe lo último del vault?",
    "Tengo un set que encaja con lo que ya te gustó. ¿Te lo dejo?",
    "Puedo ajustarte el precio del set corto si quieres probar esta línea.",
  ];
}

export const useCrm = create<CrmState>()((set, get) => ({
      ...freshData(),
      workspaceReady: false,
      workspaceNotice: null,
      teamAccess: null,
      setCreator: (id) => set({ creatorId: id }),
      setTab: (tab) => set({ inboxTab: tab }),
      setQuery: (q) => set({ query: q }),
      setEmployee: (id) => set({ activeEmployeeId: id }),
      openFan: (id) =>
        set((s) => ({
          fanId: id,
          fans: s.fans.map((f) => (f.id === id ? { ...f, unread: 0 } : f)),
        })),
      closeFan: () => set({ fanId: null }),
      setDraft: (fanId, text) => set((s) => ({ drafts: { ...s.drafts, [fanId]: text } })),
      setAttach: (id) => set({ attachVaultId: id }),
      sendMessage: ({ fanId, text, price, vaultId, mass, campaignId }) => {
        const s = get();
        const cleanRaw = text.trim();
        if (!cleanRaw && !price) return { ok: false, reason: "Escribe un mensaje." };
        const fan = s.fans.find((f) => f.id === fanId);
        const employee = s.employees.find((e) => e.id === s.activeEmployeeId);
        if (!fan || !employee) return { ok: false, reason: "Falta el fan o el empleado." };
        const clean = personalize(cleanRaw, fan);
        const hit = s.stopWords.find((w) => clean.toLowerCase().includes(w.toLowerCase()));
        const vault = s.vault.find((v) => v.id === vaultId);
        const quote = price && price > 0 && s.adaptPrices !== false ? adaptPrice(price, fan) : null;
        const msg: Msg = {
          id: uid(),
          fanId,
          creatorId: fan.creatorId,
          from: "team",
          author: employee.name,
          text: clean || vault?.title || "Contenido",
          at: Date.now(),
          creditedTo: employee.id,
          mass,
          campaignId,
          status: hit ? "retenido" : "enviado",
          flag: hit,
          ppv:
            price && price > 0
              ? {
                  title: vault?.title ?? "PPV",
                  price: quote?.price ?? price,
                  base: quote ? price : undefined,
                  band: quote?.label,
                  unlocked: false,
                  vaultId,
                }
              : undefined,
        };
        set((st) => ({
          messages: [...st.messages, msg],
          drafts: { ...st.drafts, [fanId]: "" },
          attachVaultId: null,
          vault: vault
            ? st.vault.map((v) => (v.id === vault.id ? { ...v, sent: v.sent + (hit ? 0 : 1) } : v))
            : st.vault,
        }));
        if (hit) return { ok: false as const, reason: `Bloqueado por la palabra «${hit}». No se ha entregado.` };
        return { ok: true as const, price: quote?.price ?? (price && price > 0 ? price : undefined) };
      },
      unlockPpv: (messageId) =>
        set((s) => {
          const msg = s.messages.find((m) => m.id === messageId);
          if (!msg?.ppv || msg.ppv.unlocked) return s;
          return {
            messages: s.messages.map((m) =>
              m.id === messageId && m.ppv ? { ...m, ppv: { ...m.ppv, unlocked: true } } : m,
            ),
            fans: s.fans.map((f) =>
              f.id === msg.fanId
                ? { ...f, spendLife: f.spendLife + msg.ppv!.price, spend30: f.spend30 + msg.ppv!.price }
                : f,
            ),
            campaigns: msg.campaignId
              ? s.campaigns.map((c) =>
                  c.id === msg.campaignId ? { ...c, earned: c.earned + msg.ppv!.price } : c,
                )
              : s.campaigns,
            vault: msg.ppv.vaultId
              ? s.vault.map((v) =>
                  v.id === msg.ppv!.vaultId
                    ? { ...v, unlocks: v.unlocks + 1, revenue: v.revenue + msg.ppv!.price }
                    : v,
                )
              : s.vault,
          };
        }),
      unsend: (messageId) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === messageId ? { ...m, unsent: true } : m)),
        })),
      fanReply: (fanId) =>
        set((s) => {
          const fan = s.fans.find((f) => f.id === fanId);
          if (!fan) return s;
          const text = REPLIES[Math.floor(Math.random() * REPLIES.length)] ?? REPLIES[0];
          const msg: Msg = {
            id: uid(),
            fanId,
            creatorId: fan.creatorId,
            from: "fan",
            author: fan.name,
            text,
            at: Date.now(),
            status: "enviado",
          };
          return {
            messages: [...s.messages, msg],
            fans: s.fans.map((f) => (f.id === fanId ? { ...f, unread: s.fanId === fanId ? 0 : f.unread + 1 } : f)),
          };
        }),
      saveNote: (fanId, notes) =>
        set((s) => ({ fans: s.fans.map((f) => (f.id === fanId ? { ...f, notes } : f)) })),
      addList: (name, minSpend) =>
        set((s) => ({
          lists: [
            ...s.lists,
            {
              id: uid(),
              name: name.trim() || "Lista nueva",
              detail: `Gasto 30 días ≥ $${Number(minSpend).toFixed(2)}`,
              kind: "custom",
              minSpend,
              custom: true,
            },
          ],
        })),
      removeList: (id) => set((s) => ({ lists: s.lists.filter((l) => l.id !== id || !l.custom) })),
      addCampaign: (c) =>
        set((s) => ({ campaigns: [{ ...c, id: uid(), sent: 0, earned: 0 }, ...s.campaigns] })),
      sendCampaign: (id) => {
        const s = get();
        const campaign = s.campaigns.find((c) => c.id === id);
        const list = s.lists.find((l) => l.id === campaign?.listId);
        if (!campaign || !list) return 0;
        const targets = fansForList(s.fans, list).filter((f) => {
          if (s.creatorId === "all") return true;
          return f.creatorId === s.creatorId;
        });
        const plan = massPlan(targets, campaign.price, s.adaptPrices !== false);
        targets.forEach((fan) => {
          get().sendMessage({
            fanId: fan.id,
            text: campaign.body,
            price: campaign.price,
            mass: true,
            campaignId: campaign.id,
          });
        });
        set((st) => ({
          campaigns: st.campaigns.map((c) =>
            c.id === id
              ? { ...c, status: "enviada", sent: c.sent + targets.length, sentAt: Date.now(), lastBatches: plan }
              : c,
          ),
        }));
        return plan.length;
      },
      duplicateCampaign: (id) =>
        set((s) => {
          const c = s.campaigns.find((x) => x.id === id);
          if (!c) return s;
          return {
            campaigns: [
              { ...c, id: uid(), name: `${c.name} (copia)`, status: "programada", sent: 0, earned: 0, lastBatches: undefined },
              ...s.campaigns,
            ],
          };
        }),
      setCampaignStatus: (id, status) =>
        set((s) => ({ campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, status } : c)) })),
      addScript: (script) => set((s) => ({ scripts: [...s.scripts, { ...script, id: uid() }] })),
      toggleAutomation: (id) =>
        set((s) => ({
          automations: s.automations.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)),
        })),
      updateAutomation: (id, body) =>
        set((s) => ({ automations: s.automations.map((a) => (a.id === id ? { ...a, body } : a)) })),
      togglePerm: (employeeId, perm) =>
        set((s) => ({
          employees: s.employees.map((e) => {
            if (e.id !== employeeId || e.role === "Dueña") return e;
            const has = e.perms.includes(perm);
            return { ...e, perms: has ? e.perms.filter((p) => p !== perm) : [...e.perms, perm] };
          }),
        })),
      cycleShift: (employeeId, day) =>
        set((s) => ({
          employees: s.employees.map((e) => {
            if (e.id !== employeeId) return e;
            const order = ["mañana", "noche", "libre"] as const;
            const shifts = [...e.shifts];
            const cur = shifts[day] ?? "libre";
            const next = order[(order.indexOf(cur) + 1) % order.length] ?? "libre";
            shifts[day] = next;
            return { ...e, shifts };
          }),
        })),
      addEmployee: (name, role) =>
        set((s) => ({
          employees: [
            ...s.employees,
            {
              id: uid(),
              name: name.trim() || "Nuevo",
              role,
              replyMin: null,
              online: false,
              perms: role === "Chatter" ? ["mensajes", "vault"] : role === "VA" ? ["vault"] : ["mensajes", "analitica", "equipo"],
              shifts: ["libre", "libre", "libre", "libre", "libre", "libre", "libre"],
            },
          ],
        })),
      addCreator: ({ name, nick, handle, platform, city, tag }) =>
        set((s) => ({
          creators: [
            ...s.creators,
            {
              id: uid(),
              name: name.trim() || "Creadora",
              nick: nick.trim() || name.trim() || "Creadora",
              handle: handle.startsWith("@") ? handle : `@${handle || "nueva"}`,
              platform,
              city: city.trim() || "España",
              tag: tag.trim() || "general",
              subscribers: 0,
              revenue30: null,
              growth: 0,
              split: 25,
              status: "activa",
              hue: Math.floor(Math.random() * 360),
              proxy: "IP dedicada · pendiente",
              staff: [],
            },
          ],
        })),
      addStopWord: (word) =>
        set((s) => {
          const w = word.trim().toLowerCase();
          if (!w || s.stopWords.includes(w)) return s;
          return { stopWords: [...s.stopWords, w] };
        }),
      removeStopWord: (word) => set((s) => ({ stopWords: s.stopWords.filter((w) => w !== word) })),
      setCopilot: (on) => set({ copilot: on }),
      setTranslate: (on) => set({ translate: on }),
      setAdaptPrices: (on) => set({ adaptPrices: on }),
      setNotify: (on) => set({ notifyShifts: on }),
      setAgency: (name) => set({ agency: name }),
      setDashboardConfig: (config) => set({ dashboardConfig: normalizeDashboardConfig(config) }),
      resetDemo: () => set(freshData()),
}));

export function revenue24h(messages: Msg[]) {
  return messages.filter((m) => isLast24h(m.at)).reduce((sum, m) => sum + messageValue(m), 0);
}

export function lastFanMessage(messages: Msg[], fanId: string) {
  const list = messages.filter((m) => m.fanId === fanId && !m.unsent && m.status !== "retenido");
  return list[list.length - 1];
}
