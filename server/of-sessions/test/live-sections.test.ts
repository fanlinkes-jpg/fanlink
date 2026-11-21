import assert from "node:assert/strict";
import { test } from "node:test";
import { liveDeskBrowse, liveFrameAllowed, liveOpenPageAllowed, liveRequestAllowed } from "../live/desk.ts";
import {
  liveSectionAllowedForRole,
  liveSectionPageUrl,
  liveViewSectionAccess,
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
