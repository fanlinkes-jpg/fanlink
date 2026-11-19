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
