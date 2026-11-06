import assert from "node:assert/strict";
import { test } from "node:test";
import { claimControl, deskCommand, liveLog, liveRequestAllowed, liveViewGate, mapPointer, releaseControl } from "../live/desk.ts";

const account = { creatorId: "9ikis52", accountId: "acc", handle: "bigpoppa1111", userId: "42", label: "Prueba" };

test("la vista en directo sigue apagada sin el flag o fuera de la allowlist", () => {
  assert.equal(liveViewGate(undefined, "9ikis52", account).allowed, false);
  assert.equal(liveViewGate("true", "", account).allowed, false);
  assert.equal(liveViewGate("true", "otra", account).allowed, false);
  assert.equal(liveViewGate("true", "@bigpoppa1111", account).allowed, true);
});

test("la pestaña no sale de OnlyFans ni de su CDN", () => {
  assert.equal(liveRequestAllowed("https://onlyfans.com/my/chats/chat/28022478"), true);
  assert.equal(liveRequestAllowed("https://cdn2.onlyfans.com/v.mp4"), true);
  assert.equal(liveRequestAllowed("https://example.com/"), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com.evil/x"), false);
  assert.equal(liveRequestAllowed("about:blank"), true);
});

test("el ratón del canvas cae en el viewport y Enter no es texto", () => {
  assert.deepEqual(mapPointer(10, 20, { width: 100, height: 100 }, { width: 1000, height: 500 }), { x: 100, y: 100 });
  const mouse = deskCommand({
    type: "mouse",
    action: "down",
    x: 10,
    y: 20,
    canvasWidth: 100,
    canvasHeight: 100,
    button: "left",
  }, { width: 1000, height: 500 });
  assert.equal(mouse?.method, "Input.dispatchMouseEvent");
  assert.equal(mouse?.params.x, 100);
  assert.equal(mouse?.params.y, 100);
  const enter = deskCommand({ type: "key", key: "Enter", code: "Enter", down: true }, { width: 800, height: 600 });
  assert.equal(enter?.method, "Input.dispatchKeyEvent");
  assert.equal(enter?.params.windowsVirtualKeyCode, 13);
  assert.equal(enter?.params.type, "keyDown");
  const letter = deskCommand({ type: "key", key: "a", code: "KeyA", down: true }, { width: 800, height: 600 });
  assert.equal(letter?.method, "Input.insertText");
  const paste = deskCommand({ type: "text", text: "hola secreto" }, { width: 800, height: 600 });
  assert.equal(paste?.method, "Input.insertText");
  const line = liveLog("control", { accountId: "acc", userId: "ana", fps: 4 });
  assert.equal(line.includes("hola"), false);
  assert.match(line, /\[fanlink:live\] control cuenta=acc control=ana fps=4/);
});

test("solo un visor tiene el control de la cuenta", () => {
  const first = claimControl(null, "ana");
  assert.equal(first.role, "control");
  const second = claimControl(first.holder, "luis");
  assert.equal(second.role, "view");
  assert.equal(second.holder, "ana");
  const freed = releaseControl(second.holder, "ana", ["ana", "luis"]);
  assert.equal(freed.holder, "luis");
  assert.equal(freed.next, "luis");
});
