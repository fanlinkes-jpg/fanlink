import { ClientOnly, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  CalendarClock,
  Contact,
  Home,
  Languages,
  LayoutGrid,
  Link2,
  ListFilter,
  LogIn,
  Menu,
  MessageCircle,
  MessagesSquare,
  ScrollText,
  Settings,
  Shield,
  Sparkles,
  UserRound,
  Users,
  Vault,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { Toaster } from "sonner";
import { cn } from "@/lib/cn";
import { useCrm, type Perm } from "@/lib/crm";
import { hasPerm } from "@/lib/access-policy";
import { SessionSync } from "@/components/session-sync";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { installChatSendTransport } from "@/lib/chat-send-bind";
import { chatSendSession } from "@/lib/chat-send-session";

type Item = { href: string; label: string; icon: LucideIcon; perm?: Perm };

const MENUS: { id: string; icon: LucideIcon; label: string; items: Item[] }[] = [
  {
    id: "apps",
    icon: LayoutGrid,
    label: "Aplicaciones",
    items: [
      { href: "/", label: "Inicio", icon: Home },
      { href: "/conectar", label: "Conectar cuenta", icon: LogIn },
      { href: "/mensajes", label: "Consola de mensajes", icon: MessageCircle, perm: "mensajes" },
      { href: "/vault", label: "Bóveda", icon: Vault, perm: "vault" },
      { href: "/analitica", label: "Estadísticas", icon: BarChart3, perm: "analitica" },
      { href: "/ajustes", label: "Ajustes de la cuenta", icon: Settings, perm: "ajustes" },
    ],
  },
  {
    id: "informes",
    icon: BarChart3,
    label: "Informes",
    items: [
      { href: "/analitica", label: "Informes de creador", icon: UserRound, perm: "analitica" },
      { href: "/equipo", label: "Informes de empleados", icon: Contact, perm: "equipo" },
      { href: "/analitica", label: "Informes de fans", icon: Users, perm: "analitica" },
      { href: "/auditoria", label: "Message dashboard", icon: BarChart3, perm: "analitica" },
    ],
  },
  {
    id: "crecimiento",
    icon: Sparkles,
    label: "Crecimiento",
    items: [
      { href: "/campanas", label: "Mensajes inteligentes", icon: Sparkles, perm: "campanas" },
      { href: "/listas", label: "Listas inteligentes", icon: ListFilter, perm: "campanas" },
      { href: "/automatizaciones", label: "Auto-seguir", icon: Workflow, perm: "campanas" },
      { href: "/vault", label: "Vault Pro", icon: Vault, perm: "vault" },
      { href: "/guiones", label: "Guiones", icon: ScrollText, perm: "campanas" },
      { href: "/enlaces", label: "Enlaces", icon: Link2, perm: "campanas" },
      { href: "/ajustes", label: "Palabras prohibidas", icon: Shield, perm: "ajustes" },
    ],
  },
  {
    id: "creadoras",
    icon: UserRound,
    label: "Creadoras",
    items: [{ href: "/creadoras", label: "Administrar creadoras", icon: UserRound, perm: "equipo" }],
  },
  {
    id: "equipo",
    icon: Contact,
    label: "Empleados",
    items: [
      { href: "/equipo", label: "Administrar empleados", icon: Contact, perm: "equipo" },
      { href: "/equipo", label: "Turnario", icon: CalendarClock, perm: "equipo" },
    ],
  },
];

const HINTS: Record<string, string> = {
  Inicio: "Centro de mando",
  "Conectar cuenta": "Login de la creadora",
  "Nuevo post": "Publicar desde el vault",
  Notificaciones: "Avisos de la bandeja",
  "Consola de mensajes": "Bandeja de cada sesión",
  Bóveda: "Archivos de la cuenta",
  Archivo: "Mensajes revisados",
  Colecciones: "Carpetas del vault",
  "Estados de cuenta": "Cierre e ingresos",
  Estadísticas: "Rendimiento",
  Banco: "Cobros y saldo",
  "Mi perfil": "Datos de la agencia",
  "Ajustes de la cuenta": "Traducción y precios",
  "Informes de creador": "Por cuenta",
  "Informes de empleados": "Por chatter",
  "Informes de fans": "Gasto y riesgo",
  "Message dashboard": "Calidad de la bandeja",
  "Mensajes inteligentes": "Masivos por precio",
  "Listas inteligentes": "Segmentos de fans",
  "Auto-seguir": "Reglas automáticas",
  "Vault Pro": "Ranking de sets",
  Guiones: "Textos del equipo",
  "Promoción de perfil": "Pruebas y campañas",
  "Enlaces de prueba": "Acceso gratuito",
  "Enlaces": "Pruebas y clics",
  "Palabras prohibidas": "Filtro de envío",
  "Descubre creadoras": "Cuentas de la agencia",
  Solicitudes: "Pendientes del equipo",
  "Programa S4S": "Intercambio",
  "Configuración de S4S": "Reglas del programa",
  "Administrar creadoras": "Fichas y plataformas",
  "Proxy personalizado": "IP de cada cuenta",
  "Administrar empleados": "Roles y permisos",
  Turnario: "Mañana, noche y libre",
};

function MenuFlyout({ title, items, onPick }: { title: string; items: Item[]; onPick: () => void }) {
  return (
    <div className="max-h-[70vh] w-80 overflow-auto rounded-2xl border border-[#e6e8ee] bg-[#eef0f4] p-2 shadow-xl">
      <p className="mb-2 rounded-xl bg-[#1d2433] px-3 py-2 text-[11px] font-semibold tracking-[0.14em] text-white uppercase">{title}</p>
      <div className="space-y-1.5">
        {items.map((item) => {
          const ItemIcon = item.icon;
          return (
            <Link
              key={item.label}
              to={item.href}
              onClick={onPick}
              className="flex items-center gap-3 rounded-xl border border-[#e6e8ee] bg-white px-3 py-2 hover:border-[#3b6cff]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#eef2ff] text-[#3b6cff]">
                <ItemIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight text-[#1c2333]">{item.label}</span>
                <span className="block text-xs text-[#6d7585]">{HINTS[item.label]}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-fg", className)}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <path fill="currentColor" d="M4 4h10.2a5.2 5.2 0 0 1 0 10.4H9.2V20H4V4zm5.2 6h4.6a1.8 1.8 0 0 0 0-3.6H9.2V10z" />
      </svg>
    </span>
  );
}

export function Splash() {
  return (
    <div className="grid h-dvh place-items-center bg-bg text-fg">
      <div className="flex items-center gap-3">
        <Logo />
        <div>
          <p className="font-display text-lg font-semibold">Fanlink</p>
          <p className="text-sm text-muted">Cargando operación…</p>
        </div>
      </div>
    </div>
  );
}

function ShellInner({ children, bleed }: { children: ReactNode; bleed?: boolean }) {
  const [menu, setMenu] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const setCreator = useCrm((s) => s.setCreator);
  const fans = useCrm((s) => s.fans);
  const query = useCrm((s) => s.query);
  const setQuery = useCrm((s) => s.setQuery);
  const translate = useCrm((s) => s.translate);
  const setTranslate = useCrm((s) => s.setTranslate);
  const workspaceReady = useCrm((s) => s.workspaceReady);
  const workspaceNotice = useCrm((s) => s.workspaceNotice);
  const teamAccess = useCrm((s) => s.teamAccess);
  const { user, isPending } = useCurrentUserState();
  useEffect(() => {
    installChatSendTransport();
  }, []);
  useEffect(() => {
    chatSendSession.bindUser(user?.id ?? null, { pending: isPending });
  }, [user?.id, isPending]);

  const allowed = (items: Item[]) => items.filter((item) => hasPerm(teamAccess, item.perm ?? "mensajes") || !item.perm);
  const currentOk = MENUS.flatMap((m) => m.items).every((item) => {
    const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
    if (!active || !item.perm) return true;
    return hasPerm(teamAccess, item.perm);
  });

  return (
    <>
      <SessionSync />
      {!workspaceReady || !teamAccess ? (
        <Splash />
      ) : (
        <ShellFrame
          bleed={bleed}
          menu={menu}
          setMenu={setMenu}
          mobile={mobile}
          setMobile={setMobile}
          path={path}
          navigate={navigate}
          creators={creators}
          creatorId={creatorId}
          setCreator={setCreator}
          fans={fans}
          query={query}
          setQuery={setQuery}
          translate={translate}
          setTranslate={setTranslate}
          workspaceNotice={workspaceNotice}
          teamAccess={teamAccess}
          allowed={allowed}
          currentOk={currentOk}
        >
          {children}
        </ShellFrame>
      )}
    </>
  );
}

function ShellFrame({
  children,
  bleed,
  menu,
  setMenu,
  mobile,
  setMobile,
  path,
  navigate,
  creators,
  creatorId,
  setCreator,
  fans,
  query,
  setQuery,
  translate,
  setTranslate,
  workspaceNotice,
  teamAccess,
  allowed,
  currentOk,
}: {
  children: ReactNode;
  bleed?: boolean;
  menu: string | null;
  setMenu: (value: string | null) => void;
  mobile: boolean;
  setMobile: (value: boolean) => void;
  path: string;
  navigate: ReturnType<typeof useNavigate>;
  creators: Array<{ id: string; name: string; hue: number }>;
  creatorId: string;
  setCreator: (id: string) => void;
  fans: Array<{ creatorId: string; unread: number }>;
  query: string;
  setQuery: (value: string) => void;
  translate: boolean;
  setTranslate: (value: boolean) => void;
  workspaceNotice: string | null;
  teamAccess: { displayName: string; devMode: boolean };
  allowed: (items: Item[]) => Item[];
  currentOk: boolean;
}) {

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 overflow-hidden bg-bg text-fg">
      <aside className="relative z-50 hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3 md:flex">
        <Logo className="mb-2" />
        <Link
          to="/mensajes"
          aria-label="Consola de mensajes"
          className={cn(
            "grid h-10 w-10 place-items-center rounded-xl",
            path.startsWith("/mensajes") ? "bg-[#3b6cff] text-white" : "bg-[#eef2ff] text-[#3b6cff]",
          )}
        >
          <MessagesSquare className="h-5 w-5" />
        </Link>
        {MENUS.map((group) => {
          const Icon = group.icon;
          const open = menu === group.id;
          return (
            <div key={group.id} className="relative">
              <button
                aria-label={group.label}
                onClick={() => setMenu(open ? null : group.id)}
                className={cn(
                  "grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised",
                  open && "bg-primary/10 text-primary",
                )}
              >
                <Icon className="h-5 w-5" />
              </button>
              {open && (
                <div className="absolute top-0 left-12 z-50">
                  <MenuFlyout title={group.label} items={allowed(group.items)} onPick={() => setMenu(null)} />
                </div>
              )}
            </div>
          );
        })}
        <Link to="/ajustes" aria-label="Ajustes" className="mt-auto grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised">
          <Settings className="h-5 w-5" />
        </Link>
      </aside>

      {mobile && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button className="absolute inset-0 bg-black/30" aria-label="Cerrar menú" onClick={() => setMobile(false)} />
          <div className="absolute inset-y-0 left-0 w-[22rem] overflow-auto bg-[#f4f6f8] p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-display text-sm font-semibold">Fanlink</p>
              <button onClick={() => setMobile(false)} aria-label="Cerrar"><X className="h-4 w-4" /></button>
            </div>
            {MENUS.map((group) => (
              <div key={group.id} className="mb-3">
                <MenuFlyout title={group.label} items={allowed(group.items)} onPick={() => setMobile(false)} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 bg-[#1d2433] px-2 py-1.5 text-white">
          <button className="rounded-md p-2 md:hidden" onClick={() => setMobile(true)} aria-label="Abrir menú">
            <Menu className="h-4 w-4" />
          </button>
          <Link to="/mensajes" className={cn("shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium", path.startsWith("/mensajes") ? "bg-[#3b6cff] text-white" : "bg-white text-[#1d2433]")}>
            Mensajes
          </Link>
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {creators.map((c) => {
              const unread = fans.filter((f) => f.creatorId === c.id && f.unread > 0).length;
              const active = creatorId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setCreator(c.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-lg px-2 py-1 text-xs",
                    active ? "bg-white text-[#1d2433]" : "bg-white/10",
                  )}
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold text-white" style={{ background: `hsl(${c.hue} 55% 42%)` }}>
                    {c.name.slice(0, 1)}
                  </span>
                  <span className="max-w-24 truncate">{c.name}</span>
                  {unread > 0 && <span className="rounded-full bg-danger px-1 text-[10px] text-white">{unread}</span>}
                </button>
              );
            })}
            <button onClick={() => setCreator("all")} className={cn("shrink-0 rounded-lg px-2 py-1 text-xs", creatorId === "all" ? "bg-white text-[#1d2433]" : "bg-white/10")}>
              Todas
            </button>
          </div>
          <span className="hidden max-w-40 truncate rounded-lg bg-white/10 px-2 py-1 text-xs md:inline" title={teamAccess.devMode ? "Modo local de un solo operador" : teamAccess.displayName}>
            {teamAccess.displayName}
          </span>
          <button
            aria-label="Traducción"
            onClick={() => setTranslate(translate === false)}
            className={cn("grid h-8 w-8 place-items-center rounded-lg", translate !== false ? "bg-[#ff7a2f]" : "bg-white/10")}
          >
            <Languages className="h-4 w-4" />
          </button>
          <div className="rounded-lg bg-white px-2 py-0.5 text-[#1c2333]">
            <UserButton />
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void navigate({ to: "/mensajes" });
            }}
            placeholder="Buscar"
            aria-label="Buscar fan"
            className="hidden w-28 rounded-lg border border-white/15 bg-white/10 px-2 py-1 text-xs placeholder:text-white/50 lg:block"
          />
        </header>
        <main className={cn("flex min-h-0 flex-1 flex-col", bleed ? "overflow-hidden" : "overflow-auto pb-16 md:pb-0")}>
          {teamAccess.devMode && (
            <p className="shrink-0 bg-[#fff6e8] px-4 py-2 text-xs text-[#8a5a12]">Modo local de un solo operador. Solo vale en localhost y no aísla a un equipo.</p>
          )}
          {workspaceNotice && <p className="shrink-0 bg-amber-50 px-4 py-2 text-xs text-amber-800">{workspaceNotice}</p>}
          <div className={bleed ? "relative min-h-0 flex-1 overflow-hidden" : "shrink-0"}>
            {currentOk ? children : (
              <div className="grid h-full place-items-center p-6 text-center">
                <p className="text-sm text-muted">{teamAccess.displayName} no tiene acceso a esta sección.</p>
              </div>
            )}
          </div>
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface md:hidden">
          <Link to="/" className="flex flex-1 flex-col items-center py-2 text-xs text-muted"><Home className="h-4 w-4" />Inicio</Link>
          <Link to="/mensajes" className="flex flex-1 flex-col items-center py-2 text-xs text-muted"><MessagesSquare className="h-4 w-4" />Chat</Link>
          <Link to="/campanas" className="flex flex-1 flex-col items-center py-2 text-xs text-muted"><Sparkles className="h-4 w-4" />Masivos</Link>
          <button className="flex flex-1 flex-col items-center py-2 text-xs text-muted" onClick={() => setMobile(true)}><Menu className="h-4 w-4" />Más</button>
        </nav>
      </div>
      {menu && <button className="fixed inset-0 z-40 hidden md:block" aria-label="Cerrar menú" onClick={() => setMenu(null)} />}
      <Toaster theme="light" />
    </div>
  );
}

export function AppShell({ children, bleed }: { children: ReactNode; bleed?: boolean }) {
  return (
    <ClientOnly fallback={<Splash />}>
      <ShellInner bleed={bleed}>{children}</ShellInner>
    </ClientOnly>
  );
}
