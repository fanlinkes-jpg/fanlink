import assert from "node:assert/strict";
import { test } from "node:test";
import { createChatSendSession, REAL_SEND_OFF_REASON, type ComposerSend } from "./chat-send-session.ts";

const draft: ComposerSend = {
  body: "hola",
  creatorId: "c-1",
  threadKey: "hilo",
  fanKey: "7",
  priceCents: 500,
  priceLabel: "$5.00",
  vault: [{ id: "v1", name: "playa" }],
};

test("doble Enter real, mismo cuerpo, es un solo envío", async () => {
  let n = 0;
  const session = createChatSendSession({ uuid: () => `id-${++n}` });
  const calls: string[] = [];
  session.setTransport(async (job) => {
    calls.push(job.clientId);
    return { sent: true, reason: null, messageId: "m-1" };
  });
  const first = session.press({ ...draft, key: "Enter", shiftKey: false, realSend: true, now: 5_000 });
  const second = session.press({ ...draft, key: "Enter", shiftKey: false, realSend: true, now: 5_400 });
  assert.equal(first.action, "queued");
  assert.equal(second.action, "duplicate");
  assert.equal(session.getJobs().length, 1);
  assert.equal(session.getJobs()[0]?.clientId, "id-1");
  assert.equal(session.getJobs()[0]?.priceCents, 500);
  assert.deepEqual(session.getJobs()[0]?.vault, [{ id: "v1", name: "playa" }]);
  await session.whenIdle();
  assert.deepEqual(calls, ["id-1"]);
  assert.equal(session.getJobs()[0]?.state, "sent");
});

test("si el primero falla, el siguiente del hilo no sale y el otro hilo sí", async () => {
  let n = 0;
  const session = createChatSendSession({ uuid: () => `id-${++n}` });
  const sent: string[] = [];
  session.setTransport(async (job) => {
    sent.push(`${job.threadKey}:${job.body}`);
    if (job.body === "uno") return { sent: false, reason: "cayó", messageId: null };
    return { sent: true, reason: null, messageId: "m" };
  });
  session.submit({ ...draft, body: "uno", realSend: true, now: 1_000 });
  session.submit({ ...draft, body: "dos", realSend: true, now: 3_000 });
  session.submit({ ...draft, body: "otro", threadKey: "b", realSend: true, now: 4_000 });
  await session.whenIdle();
  assert.deepEqual(sent, ["hilo:uno", "b:otro"]);
  assert.equal(sent.includes("hilo:dos"), false);
  assert.equal(session.getJobs().find((job) => job.body === "dos")?.state, "queued");
  assert.equal(session.getJobs().find((job) => job.body === "uno")?.state, "error");
});

test("desmontar la página no vacía la cola", () => {
  const session = createChatSendSession({ uuid: () => "id-1" });
  session.setTransport(() => new Promise(() => undefined));
  const mounted = session.subscribe(() => undefined);
  const queued = session.press({ ...draft, key: "Enter", shiftKey: false, realSend: true, now: 1_000 });
  assert.equal(queued.action, "queued");
  mounted();
  assert.equal(session.getJobs().length, 1);
  assert.equal(session.getJobs()[0]?.clientId, "id-1");
  const seen: string[] = [];
  session.subscribe(() => {
    seen.push(session.getJobs()[0]?.body ?? "");
  });
  session.noteFailure("id-1", "sigue");
  assert.deepEqual(seen, ["hola"]);
  assert.equal(session.getJobs()[0]?.state, "error");
  assert.equal(session.shouldWarn(), true);
});

test("cerrar sesión o cambiar de usuario vacía la cola", () => {
  const session = createChatSendSession({ uuid: () => "id-1" });
  session.setTransport(() => new Promise(() => undefined));
  session.bindUser("ana");
  session.press({ ...draft, key: "Enter", shiftKey: false, realSend: true, now: 1_000 });
  assert.equal(session.getJobs().length, 1);
  session.bindUser("ana");
  assert.equal(session.getJobs().length, 1);
  session.bindUser("luis");
  assert.equal(session.getJobs().length, 0);
  session.press({ ...draft, key: "Enter", shiftKey: false, realSend: true, now: 2_000 });
  assert.equal(session.getJobs().length, 1);
  session.reset();
  assert.equal(session.getJobs().length, 0);
  assert.equal(session.shouldWarn(), false);
});

test("Enter encola y Mayúsculas+Enter no", () => {
  const session = createChatSendSession({ uuid: () => "id-1" });
  session.setTransport(() => new Promise(() => undefined));
  const shift = session.press({ ...draft, key: "Enter", shiftKey: true, realSend: true, now: 1_000 });
  assert.equal(shift.action, "newline");
  assert.equal(session.getJobs().length, 0);
  const composing = session.press({ ...draft, key: "Enter", shiftKey: false, composing: true, realSend: true, now: 1_100 });
  assert.equal(composing.action, "ignored");
  assert.equal(session.getJobs().length, 0);
  const enter = session.press({ ...draft, key: "Enter", shiftKey: false, realSend: true, now: 2_000 });
  assert.equal(enter.action, "queued");
  assert.equal(session.getJobs().length, 1);
});

test("sin envío real no se encola y se dice el motivo", () => {
  const session = createChatSendSession({ uuid: () => "id-1" });
  let opened = 0;
  session.setTransport(async () => {
    opened += 1;
    return { sent: true, reason: null, messageId: "no" };
  });
  const blocked = session.press({ ...draft, key: "Enter", shiftKey: false, realSend: false, now: 1_000 });
  assert.equal(blocked.action, "blocked");
  if (blocked.action === "blocked") assert.equal(blocked.reason, REAL_SEND_OFF_REASON);
  assert.equal(session.getJobs().length, 0);
  assert.equal(opened, 0);
  assert.equal(session.shouldWarn(), false);
});
