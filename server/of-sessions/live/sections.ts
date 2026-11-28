export const LIVE_SECTIONS = ["chat", "notifications"] as const;
export type LiveSection = (typeof LIVE_SECTIONS)[number];

const SECTION_PAGES: Record<LiveSection, string> = {
  chat: "https://onlyfans.com/my/chats",
  notifications: "https://onlyfans.com/my/notifications",
};

const SECTION_PREFIXES: Record<LiveSection, readonly string[]> = {
  chat: ["/my/chats", "/api2/v2/chats", "/api2/v2/messages"],
  notifications: ["/my/notifications", "/api2/v2/users/notifications"],
};

/** El cliente solo puede enviar estas claves. Una URL u otra sección se rechaza. */
export function parseLiveSection(value: unknown): LiveSection | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (key === "chat" || key === "notifications") return key;
  return null;
}

export function liveSectionPageUrl(section: LiveSection): string {
  return SECTION_PAGES[section];
}

export function liveSectionPrefixes(section: LiveSection): readonly string[] {
  return SECTION_PREFIXES[section];
}

/** Las notificaciones nativas son solo de la dueña. El chat sigue el permiso de mensajes. */
export function liveSectionAllowedForRole(section: LiveSection, role: "owner" | "member" | null): boolean {
  if (section === "notifications") return role === "owner";
  return role === "owner" || role === "member";
}

export function liveSectionPathAllowed(section: LiveSection, path: string): boolean {
  return liveSectionPrefixes(section).some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function liveViewSectionAccess(
  sectionRaw: unknown,
  role: "owner" | "member" | null,
): { ok: true; section: LiveSection } | { ok: false; reason: string } {
  const section = parseLiveSection(sectionRaw ?? "chat");
  if (!section) return { ok: false, reason: "Esa sección no está disponible en la vista nativa." };
  if (!liveSectionAllowedForRole(section, role)) {
    return { ok: false, reason: "Solo la dueña puede abrir las notificaciones de OnlyFans." };
  }
  return { ok: true, section };
}

/**
 * Secciones del menú de Operativa. El cliente solo envía el `id`; la ruta sale de aquí, nunca de una URL suya.
 * `restricted` marca las que caen en zonas que la vista cierra por defecto (estados, estadísticas, banca, ajustes):
 * solo se abren si la dueña las elige en el menú y solo con la ruta de esa entrada.
 */
export const DESK_PAGES = [
  { id: "home", label: "Inicio", path: "/", restricted: false },
  { id: "new-post", label: "Nuevo post", path: "/posts/create", restricted: false },
  { id: "notifications", label: "Notificaciones", path: "/my/notifications", restricted: false },
  { id: "vault", label: "Bóveda", path: "/my/vault", restricted: false },
  { id: "archive", label: "Archivo", path: "/my/collections/post-labels/archived", restricted: false },
  { id: "collections", label: "Colecciones", path: "/my/collections", restricted: false },
  { id: "statements", label: "Estados de cuenta", path: "/my/statements", restricted: true },
  { id: "statistics", label: "Estadísticas", path: "/my/statistics", restricted: true },
  { id: "banking", label: "Banco", path: "/my/banking", restricted: true },
  { id: "profile", label: "Mi perfil", path: "/my/profile", restricted: false },
  { id: "settings", label: "Ajustes de OF", path: "/my/settings", restricted: true },
  { id: "release-forms", label: "Release forms", path: "/my/release-forms", restricted: false },
] as const;

export type DeskPageId = (typeof DESK_PAGES)[number]["id"];
export type DeskPage = (typeof DESK_PAGES)[number];

export function parseDeskPage(value: unknown): DeskPage | null {
  if (typeof value !== "string") return null;
  return DESK_PAGES.find((page) => page.id === value.trim()) ?? null;
}

export function deskPageUrl(page: DeskPage): string {
  return `https://onlyfans.com${page.path}`;
}

/** La ruta pertenece a esa entrada: la suya o una de debajo. Inicio solo es la raíz. */
export function deskPagePathMatches(page: DeskPage, rawPath: string): boolean {
  let path = rawPath.toLowerCase();
  try {
    path = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (path.includes("..") || path.includes("\\")) return false;
  if (page.path === "/") return path === "/" || path === "";
  return path === page.path || path.startsWith(`${page.path}/`);
}

/** Prefijo que el visor deja abrir aunque caiga en una zona cerrada. Vacío para el resto. */
export function deskPageOpenPrefix(page: DeskPage | null): string {
  return page?.restricted ? page.path : "";
}
