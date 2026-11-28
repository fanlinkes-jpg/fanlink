import assert from "node:assert/strict";
import { test } from "node:test";
import { liveDeskBrowse, liveDeskPageOpen, liveFrameAllowed, liveOpenPageAllowed, liveRequestAllowed } from "../live/desk.ts";
import {
  DESK_PAGES,
  deskPageOpenPrefix,
  deskPagePathMatches,
  deskPageUrl,
  liveSectionAllowedForRole,
  liveSectionPageUrl,
  liveViewSectionAccess,
  parseDeskPage,
  parseLiveSection,
} from "../live/sections.ts";

test("la lista blanca solo admite chat y notifications, no una URL libre", () => {
  assert.equal(parseLiveSection("notifications"), "notifications");
  assert.equal(parseLiveSection("chat"), "chat");
  assert.equal(parseLiveSection("banking"), null);
  assert.equal(parseLiveSection("statements"), null);
  assert.equal(parseLiveSection("statistics"), null);
  assert.equal(parseLiveSection("https://onlyfans.com/my/notifications"), null);
  assert.equal(parseLiveSection("https://onlyfans.com/my/banking"), null);
  assert.equal(parseLiveSection("/my/notifications"), null);
  assert.equal(parseLiveSection(""), null);
  assert.equal(parseLiveSection(undefined), null);
  assert.equal(liveSectionPageUrl("notifications"), "https://onlyfans.com/my/notifications");
});

test("notifications deja pasar su página y sigue bloqueando banca y estados", () => {
  assert.equal(liveRequestAllowed("https://onlyfans.com/my/notifications", "GET", false, "notifications"), true);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/users/notifications?limit=20", "GET", false, "notifications"), true);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/users/me", "GET", false, "notifications"), true);
  assert.equal(liveRequestAllowed("https://onlyfans.com/my/banking", "GET", false, "notifications"), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/my/statements", "GET", false, "notifications"), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/my/statements/earnings", "GET", false, "notifications"), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/my/statistics", "GET", false, "notifications"), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/my/settings", "GET", false, "notifications"), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/my/payouts", "GET", false, "notifications"), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/my/chats", "GET", false, "notifications"), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1", "GET", false, "notifications"), true);
  assert.equal(liveRequestAllowed("https://onlyfans.com/cdn-cgi/challenge-platform/h/g/flow/ov1", "POST", false, "notifications"), true);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/users/notifications", "POST", false, "notifications"), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/cdn-cgi/../my/banking", "POST", false, "notifications"), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/cdn-cgi/challenge-platform/h/g/flow/ov1", "PUT", false, "notifications"), false);
});

test("operativa recorre OnlyFans y bloquea banca, estados, pagos y ajustes", () => {
  assert.equal(liveOpenPageAllowed("https://onlyfans.com/my/chats"), true);
  assert.equal(liveOpenPageAllowed("https://onlyfans.com/my/vault"), true);
  assert.equal(liveOpenPageAllowed("https://onlyfans.com/my/notifications"), true);
  assert.equal(liveOpenPageAllowed("https://onlyfans.com/my/banking"), false);
  assert.equal(liveOpenPageAllowed("https://onlyfans.com/my/statements"), false);
  assert.equal(liveOpenPageAllowed("https://onlyfans.com/my/payouts"), false);
  assert.equal(liveOpenPageAllowed("https://onlyfans.com/my/settings"), false);
  assert.equal(liveFrameAllowed("https://onlyfans.com/my/chats", "notifications"), true);
  assert.equal(liveFrameAllowed("https://onlyfans.com/my/settings/profile", "notifications"), false);
  assert.equal(liveDeskBrowse("notifications", "control", "mouse"), true);
  assert.equal(liveDeskBrowse("notifications", "control", "key"), true);
  assert.equal(liveDeskBrowse("notifications", "view", "mouse"), false);
  assert.equal(liveDeskBrowse("chat", "control", "key"), false);
  assert.equal(liveDeskBrowse("notifications", "control", "file"), false);
});

test("solo la dueña abre la sección de notificaciones", () => {
  assert.equal(liveSectionAllowedForRole("notifications", "owner"), true);
  assert.equal(liveSectionAllowedForRole("notifications", "member"), false);
  assert.equal(liveSectionAllowedForRole("notifications", null), false);
  assert.equal(liveSectionAllowedForRole("chat", "owner"), true);
  assert.equal(liveSectionAllowedForRole("chat", "member"), true);
  assert.equal(liveViewSectionAccess("notifications", "owner").ok, true);
  assert.equal(liveViewSectionAccess("notifications", "member").ok, false);
  assert.equal(liveViewSectionAccess("banking", "owner").ok, false);
  assert.equal(liveViewSectionAccess("https://onlyfans.com/my/banking", "owner").ok, false);
  const denied = liveViewSectionAccess("notifications", "member");
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.match(denied.reason, /dueña/);
});

test("el menú de Operativa tiene las 12 secciones y rutas fijas de OnlyFans", () => {
  assert.deepEqual(DESK_PAGES.map((page) => page.label), [
    "Inicio", "Nuevo post", "Notificaciones", "Bóveda", "Archivo", "Colecciones",
    "Estados de cuenta", "Estadísticas", "Banco", "Mi perfil", "Ajustes de OF", "Release forms",
  ]);
  assert.equal(deskPageUrl(parseDeskPage("notifications")!), "https://onlyfans.com/my/notifications");
  assert.equal(deskPageUrl(parseDeskPage("home")!), "https://onlyfans.com/");
  assert.equal(deskPageUrl(parseDeskPage("banking")!), "https://onlyfans.com/my/banking");
  for (const page of DESK_PAGES) assert.match(page.path, /^\/(?:[a-z0-9_-]+(?:\/[a-z0-9_-]+)*)?$/);
});

test("el cliente solo elige por clave: una URL o una clave rara no vale", () => {
  assert.equal(parseDeskPage("https://onlyfans.com/my/banking"), null);
  assert.equal(parseDeskPage("/my/banking"), null);
  assert.equal(parseDeskPage("payouts"), null);
  assert.equal(parseDeskPage(""), null);
  assert.equal(parseDeskPage(undefined), null);
  assert.equal(parseDeskPage("banking")?.id, "banking");
  assert.equal(parseDeskPage("chats"), null);
  assert.equal(parseDeskPage("messages"), null);
  assert.equal(DESK_PAGES.some((page) => page.path.startsWith("/my/chats")), false);
});

test("una zona cerrada solo se abre con la ruta de la entrada elegida", () => {
  const banking = parseDeskPage("banking")!;
  const settings = parseDeskPage("settings")!;
  const vault = parseDeskPage("vault")!;
  assert.equal(liveFrameAllowed("https://onlyfans.com/my/banking", "notifications"), false);
  assert.equal(liveFrameAllowed("https://onlyfans.com/my/banking", "notifications", banking), true);
  assert.equal(liveFrameAllowed("https://onlyfans.com/my/banking/secondary", "notifications", banking), true);
  assert.equal(liveFrameAllowed("https://onlyfans.com/my/statements", "notifications", banking), false);
  assert.equal(liveFrameAllowed("https://onlyfans.com/my/settings/security", "notifications", banking), false);
  assert.equal(liveFrameAllowed("https://onlyfans.com/my/settings/security", "notifications", settings), true);
  assert.equal(liveDeskPageOpen("https://onlyfans.com/my/bankingx", banking), false);
  assert.equal(liveFrameAllowed("https://evil.example/my/banking", "notifications", banking), false);
  assert.equal(liveFrameAllowed("https://onlyfans.com/my/banking", "notifications", vault), false);
  assert.equal(liveFrameAllowed("https://onlyfans.com/my/banking", "chat", banking), false);
  assert.equal(liveDeskPageOpen("https://onlyfans.com/my/vault", vault), false);
  assert.equal(deskPageOpenPrefix(banking), "/my/banking");
  assert.equal(deskPageOpenPrefix(vault), "");
  assert.equal(deskPageOpenPrefix(null), "");
});

test("Inicio solo es la raíz y las entradas abiertas siguen abiertas", () => {
  const home = parseDeskPage("home")!;
  assert.equal(deskPagePathMatches(home, "/"), true);
  assert.equal(deskPagePathMatches(home, "/my/banking"), false);
  assert.equal(deskPagePathMatches(parseDeskPage("vault")!, "/my/vault/media/1"), true);
  assert.equal(deskPagePathMatches(parseDeskPage("vault")!, "/my/vault/../banking"), false);
  for (const page of DESK_PAGES) {
    if (page.restricted) continue;
    assert.equal(liveFrameAllowed(`https://onlyfans.com${page.path}`, "notifications", page), true, page.id);
  }
});

test("el ticket de Operativa lleva la entrada y el resto de secciones no", async () => {
  const { issueLiveTicket, takeLiveTicket } = await import("../live/tickets.ts");
  const base = { userId: "u", accountId: "a", creatorId: "c", threadKey: "notifications", fanKey: null, accountUserId: null };
  assert.equal(takeLiveTicket(issueLiveTicket({ ...base, section: "notifications", page: "vault" }))?.page, "vault");
  assert.equal(takeLiveTicket(issueLiveTicket({ ...base, section: "notifications" }))?.page, null);
  assert.equal(takeLiveTicket(issueLiveTicket(base))?.page, null);
});
