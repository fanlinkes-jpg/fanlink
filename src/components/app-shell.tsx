import { ClientOnly, Link, useRouterState } from "@tanstack/react-router";
import { readInboxCreator, resolveInboxCreator, showsCreatorRail, writeInboxCreator } from "@/lib/inbox-scope";
import { CreatorRail } from "@/components/creator-rail";
import { bindUiUser, COMPOSER_LANGUAGES, setSfwEnabled, useComposerLanguage, useSfw } from "@/lib/ui-prefs";
import { AutoTranslateSwitch, TranslateMenu } from "@/features/translate-ui";
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
import { useCrm } from "@/lib/crm";
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
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const setCreator = useCrm((s) => s.setCreator);
  const workspaceReady = useCrm((s) => s.workspaceReady);
  const workspaceNotice = useCrm((s) => s.workspaceNotice);
  const teamAccess = useCrm((s) => s.teamAccess);
  const { user, isPending } = useCurrentUserState();
  useEffect(() => {
    installChatSendTransport();
  }, []);
  useEffect(() => {
    chatSendSession.bindUser(user?.id ?? null, { pending: isPending });
    bindUiUser(user?.id ?? null);
  }, [user?.id, isPending]);

  const creatorRail = showsCreatorRail(path);
  const rememberedCreator = typeof window === "undefined" ? null : readInboxCreator(window.localStorage);
  const resolvedCreator = resolveInboxCreator({ requested: creatorId, creators, remembered: rememberedCreator });
  useEffect(() => {
    if (!creatorRail || !resolvedCreator) return;
    writeInboxCreator(window.localStorage, resolvedCreator);
    if (resolvedCreator !== creatorId) setCreator(resolvedCreator);
  }, [creatorRail, resolvedCreator, creatorId, setCreator]);
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
          creatorRail={creatorRail}
          workspaceNotice={workspaceNotice}
          teamAccess={teamAccess}
          blocks={blocks}
          currentOk={currentOk}
        >
          {children}
        </ShellFrame>
      )}
    </>
  );
}

function HeaderTools({ devMode, displayName }: { devMode: boolean; displayName: string }) {
  const language = useComposerLanguage();
  const sfw = useSfw();
  const [open, setOpen] = useState(false);
  const current = COMPOSER_LANGUAGES.find((item) => item.id === language) ?? COMPOSER_LANGUAGES[0];
  const localHint = "Modo local de un solo operador. Solo vale en localhost y no aísla a un equipo.";
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="relative">
        <button
          type="button"
          aria-label="Traducción"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={cn("flex h-8 items-center gap-1 rounded-lg px-2", open ? "bg-[#ff7a2f]" : "bg-white/10")}
        >
          <Languages className="h-4 w-4" />
          <span className="text-[10px] font-semibold uppercase">{current.id}</span>
        </button>
        {open ? <TranslateMenu onClose={() => setOpen(false)} /> : null}
      </div>
      <AutoTranslateSwitch />
      <button
        type="button"
        role="switch"
        aria-checked={sfw}
        aria-label="SFW"
        onClick={() => setSfwEnabled(!sfw)}
        className={cn("h-8 rounded-lg px-2 text-xs font-semibold", sfw ? "bg-[#1f9d55] text-white" : "bg-white/10")}
      >
        SFW
      </button>
      <div className="rounded-lg bg-white px-2 py-0.5 text-[#1c2333]" title={devMode ? localHint : displayName}>
        <UserButton />
      </div>
    </div>
  );
}

function ShellFrame({
  children,
  bleed,
  mobile,
  setMobile,
  path,
  creatorRail,
  workspaceNotice,
  teamAccess,
  blocks,
  currentOk,
}: {
  children: ReactNode;
  bleed?: boolean;
  mobile: boolean;
  setMobile: (value: boolean) => void;
  path: string;
  creatorRail: boolean;
  workspaceNotice: string | null;
  teamAccess: { displayName: string; devMode: boolean };
  blocks: NavLink[];
  currentOk: boolean;
}) {

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 overflow-hidden bg-bg text-fg">
      <aside className="relative z-50 hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3 md:flex">
        <Logo className="mb-2" />
        {blocks.map((block) => {
          const Icon = BLOCK_ICONS[block.id] ?? LayoutGrid;
          const active = pathMatchesNavLink(path, block);
          return (
            <NavRouteLink
              key={block.id}
              item={block}
              aria-label={block.label}
              className={cn(
                "grid h-10 w-10 place-items-center rounded-xl",
                active ? "bg-[#3b6cff] text-white" : "text-muted hover:bg-raised",
              )}
            >
              <Icon className="h-5 w-5" />
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
          <span className="min-w-0 flex-1" />
          <HeaderTools devMode={teamAccess.devMode} displayName={teamAccess.displayName} />
        </header>
        <main className={cn("flex min-h-0 flex-1", creatorRail ? "overflow-hidden" : bleed ? "flex-col overflow-hidden" : "flex-col overflow-auto pb-16 md:pb-0")}>
          {creatorRail ? <CreatorRail /> : null}
          <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", creatorRail && !bleed ? "overflow-auto pb-16 md:pb-0" : undefined)}>
            {workspaceNotice && <p className="shrink-0 bg-amber-50 px-4 py-2 text-xs text-amber-800">{workspaceNotice}</p>}
            <div className={bleed ? "relative min-h-0 flex-1 overflow-hidden" : creatorRail ? "min-h-0" : "shrink-0"}>
              {currentOk ? children : (
                <div className="grid h-full place-items-center p-6 text-center">
                  <p className="text-sm text-muted">{teamAccess.displayName} no tiene acceso a esta sección.</p>
                </div>
              )}
            </div>
          </div>
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface md:hidden">
          <Link to="/" className="flex flex-1 flex-col items-center py-2 text-xs text-muted"><Home className="h-4 w-4" />Dashboard</Link>
          <Link to="/mensajes" className="flex flex-1 flex-col items-center py-2 text-xs text-muted"><MessagesSquare className="h-4 w-4" />Chat</Link>
          {blocks.some((block) => block.id === "funciones-inteligentes") ? (
            <Link to="/funciones" search={{ tab: "masivos" }} className="flex flex-1 flex-col items-center py-2 text-xs text-muted"><Sparkles className="h-4 w-4" />Funciones</Link>
          ) : null}
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
