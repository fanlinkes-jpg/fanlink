import { ClientOnly, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { listCreatorChats } from "@/lib/of-sessions";
import { unreadTotalFor } from "../../server/of-sessions/sync/unread-chats.ts";
import { useEffect, useState, type ReactNode } from "react";
import {
  Home,
  Languages,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  MessagesSquare,
  Settings,
  Shield,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Toaster } from "sonner";
import { cn } from "@/lib/cn";
import { CreatorMark } from "@/components/creator-mark";
import { useCrm } from "@/lib/crm";
import { useCreatorSessions } from "@/lib/use-creator-sessions";
import {
  canAccessPath,
  navRoleFromAccess,
  pathMatchesNavLink,
  visibleNavBlocks,
  type NavLink,
} from "@/lib/nav-config";
import { SessionSync } from "@/components/session-sync";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { installChatSendTransport } from "@/lib/chat-send-bind";
import { chatSendSession } from "@/lib/chat-send-session";

const BLOCK_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  operativa: LayoutGrid,
  chat: MessagesSquare,
  "funciones-inteligentes": Sparkles,
  administrar: Users,
  proxys: Shield,
  configuracion: Settings,
};

function NavRouteLink({
  item,
  className,
  onClick,
  children,
  ...rest
}: {
  item: NavLink;
  className?: string;
  onClick?: () => void;
  "aria-label"?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={item.to as never}
      params={(item.params ?? {}) as never}
      search={(item.search ?? {}) as never}
      onClick={onClick}
      className={className}
      {...rest}
    >
      {children}
    </Link>
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

  const unreadChats = useUnreadChats(creatorId);
  const { sessions } = useCreatorSessions();
  const avatars = Object.fromEntries(sessions.map((session) => [session.creatorId, session.avatarUrl]));
  const navRole = navRoleFromAccess(teamAccess);
  const blocks = visibleNavBlocks(navRole, teamAccess);
  const currentOk = canAccessPath(path, navRole, teamAccess);

  return (
    <>
      <SessionSync />
      {!workspaceReady || !teamAccess ? (
        <Splash />
      ) : (
        <ShellFrame
          bleed={bleed}
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
          blocks={blocks}
          currentOk={currentOk}
          unreadChats={unreadChats}
          avatars={avatars}
        >
          {children}
        </ShellFrame>
      )}
    </>
  );
}

function unreadLabel(total: number | null, name: string): string {
  if (total == null) return `${name}, Sin datos`;
  if (total > 0) return `${name}, ${total} chats sin leer`;
  return name;
}

function useUnreadChats(creatorId: string): number | null {
  const [state, setState] = useState<{ status: "loading" | "error" | "ready"; threads: Array<{ creatorId: string; unread: number | null }> }>({
    status: "loading",
    threads: [],
  });
  useEffect(() => {
    let stop = false;
    const pull = () => {
      void listCreatorChats().then((list) => {
        if (!stop) setState({ status: "ready", threads: list.threads });
      }).catch(() => {
        if (!stop) setState({ status: "error", threads: [] });
      });
    };
    pull();
    const timer = window.setInterval(pull, 15_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);
  return unreadTotalFor(state.status, state.threads, creatorId);
}

function ShellFrame({
  children,
  bleed,
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
  blocks,
  currentOk,
  unreadChats,
  avatars,
}: {
  children: ReactNode;
  bleed?: boolean;
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
  blocks: NavLink[];
  currentOk: boolean;
  unreadChats: number | null;
  avatars: Record<string, string | null>;
}) {

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 overflow-hidden bg-bg text-fg">
      <aside className="relative z-50 hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3 md:flex">
        <Logo className="mb-2" />
        {blocks.map((block) => {
          const Icon = BLOCK_ICONS[block.id] ?? LayoutGrid;
          const active = pathMatchesNavLink(path, block);
          const isChat = block.id === "chat";
          return (
            <NavRouteLink
              key={block.id}
              item={block}
              aria-label={isChat ? unreadLabel(unreadChats, block.label) : block.label}
              title={isChat && unreadChats == null ? "Sin datos" : undefined}
              className={cn(
                "relative grid h-10 w-10 place-items-center rounded-xl",
                active ? "bg-[#3b6cff] text-white" : "text-muted hover:bg-raised",
              )}
            >
              <Icon className="h-5 w-5" />
              {isChat && unreadChats != null && unreadChats > 0 ? <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unreadChats}</span> : null}
            </NavRouteLink>
          );
        })}
      </aside>

      {mobile && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button className="absolute inset-0 bg-black/30" aria-label="Cerrar menú" onClick={() => setMobile(false)} />
          <div className="absolute inset-y-0 left-0 w-[22rem] overflow-auto bg-[#f4f6f8] p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-display text-sm font-semibold">Fanlink</p>
              <button onClick={() => setMobile(false)} aria-label="Cerrar"><X className="h-4 w-4" /></button>
            </div>
            {blocks.map((block) => {
              const Icon = BLOCK_ICONS[block.id] ?? LayoutGrid;
              return (
                <NavRouteLink
                  key={block.id}
                  item={block}
                  onClick={() => setMobile(false)}
                  className="mb-1 flex items-center gap-3 rounded-xl border border-[#e6e8ee] bg-white px-3 py-2"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#eef2ff] text-[#3b6cff]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight text-[#1c2333]">{block.label}</span>
                    <span className="block text-xs text-[#6d7585]">{block.hint}</span>
                  </span>
                </NavRouteLink>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 bg-[#1d2433] px-2 py-1.5 text-white">
          <button className="rounded-md p-2 md:hidden" onClick={() => setMobile(true)} aria-label="Abrir menú">
            <Menu className="h-4 w-4" />
          </button>
          <Link to="/mensajes" aria-label={unreadLabel(unreadChats, "Mensajes")} title={unreadChats == null ? "Sin datos" : undefined} className={cn("flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium", path.startsWith("/mensajes") ? "bg-[#3b6cff] text-white" : "bg-white text-[#1d2433]")}>
            Mensajes
            {unreadChats == null ? <span className="text-[10px] font-semibold opacity-80">Sin datos</span> : unreadChats > 0 ? <span className="rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unreadChats}</span> : null}
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
                  <CreatorMark name={c.name} hue={c.hue} avatarUrl={avatars[c.id]} />
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
          <Link to="/funciones" search={{ tab: "masivos" }} className="flex flex-1 flex-col items-center py-2 text-xs text-muted"><Sparkles className="h-4 w-4" />Funciones</Link>
          <button className="flex flex-1 flex-col items-center py-2 text-xs text-muted" onClick={() => setMobile(true)}><Menu className="h-4 w-4" />Más</button>
        </nav>
      </div>
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
