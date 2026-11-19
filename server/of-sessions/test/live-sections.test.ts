import assert from "node:assert/strict";
import { test } from "node:test";
import { liveRequestAllowed } from "../live/desk.ts";
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
