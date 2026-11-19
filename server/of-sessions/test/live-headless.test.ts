import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserContext } from "playwright";
import { isLiveChallengeText, LIVE_CHALLENGE_NOTICE } from "../live/challenge.ts";
import { liveViewHeadless } from "../live/headless.ts";
import { messages } from "../messages.ts";
import { ProfileOwner } from "../sessions/profile-owner.ts";
import { SessionPendingError } from "../types.ts";

test("el live view es visible en un Mac y en Linux con pantalla, salvo que se fuerce headless", () => {
  const mac = { platform: "darwin" as const };
  const win = { platform: "win32" as const };
  const linuxScreen = { platform: "linux" as const, display: ":0" };
  const linuxWayland = { platform: "linux" as const, wayland: "wayland-0" };
  const linuxHeadless = { platform: "linux" as const };
  assert.equal(liveViewHeadless({}, mac), false);
  assert.equal(liveViewHeadless({}, win), false);
  assert.equal(liveViewHeadless({}, linuxScreen), false);
  assert.equal(liveViewHeadless({}, linuxWayland), false);
  assert.equal(liveViewHeadless({}, linuxHeadless), true);
  assert.equal(liveViewHeadless({ FANLINK_LIVE_VIEW_HEADLESS: "true" }, mac), true);
  assert.equal(liveViewHeadless({ FANLINK_LIVE_VIEW_HEADLESS: "false" }, linuxHeadless), false);
  assert.equal(liveViewHeadless({ FANLINK_LIVE_VIEW_HEADLESS: "0" }, linuxHeadless), false);
  assert.equal(liveViewHeadless({ FANLINK_LIVE_VIEW_HEADLESS: "1" }, mac), true);
});

test("detecta el texto del reto antibots de OnlyFans", () => {
  assert.equal(isLiveChallengeText("Just a moment... We'll try your destination again in 15 seconds"), true);
  assert.equal(isLiveChallengeText("JUST A MOMENT… we'll try your destination again"), true);
  assert.equal(isLiveChallengeText("Checking if the site connection is secure"), true);
  assert.equal(isLiveChallengeText("Notifications\nAll activity"), false);
  assert.ok(LIVE_CHALLENGE_NOTICE.includes("comprobación antibots"));
});

test("la vista nativa no reutiliza un Chromium headless ya abierto", async () => {
  const opened: string[] = [];
  const contexts = { shared: fakeContext(), visible: fakeContext() };
  const owner = new ProfileOwner({
    async openShared() {
      opened.push("shared");
      return contexts.shared;
    },
    async openExclusive() {
      opened.push("exclusive");
      return fakeContext();
    },
    async openVisible() {
      opened.push("visible");
      return contexts.visible;
    },
    async persist() {},
    async closeContext() {},
    isStopped() {
      return false;
    },
  });

  const work = await owner.lease("acc-1");
  assert.deepEqual(opened, ["shared"]);
  const visibleJob = owner.leaseVisible("acc-1");
  await Promise.resolve();
  await work.release();
  const live = await visibleJob;
  assert.deepEqual(opened, ["shared", "visible"]);
  assert.equal(live.context, contexts.visible);

  const again = await owner.leaseVisible("acc-1");
  assert.equal(again.context, contexts.visible);
  assert.deepEqual(opened, ["shared", "visible"]);
  await assert.rejects(() => owner.lease("acc-1"), (error: unknown) => {
    assert.ok(error instanceof SessionPendingError);
    assert.equal(error.message, messages.liveViewInProgress);
    return true;
  });
  await again.release();
  await live.release();
});

function fakeContext(): BrowserContext {
  return {} as BrowserContext;
}
