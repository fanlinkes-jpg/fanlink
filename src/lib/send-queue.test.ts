import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingForThread } from "./pending-thread.ts";
import {
  acceptSend,
  applyDiscardResult,
  bubbleCaption,
  draftFromPending,
  draftFromRejected,
  enterSendsMessage,
  holdsForUser,
  pendingBesideLocal,
  reconcileBubbles,
  runnableJobIds,
  shouldWarnOnLeave,
  type SendJob,
} from "./send-queue.ts";

function job(patch: Partial<SendJob> & Pick<SendJob, "clientId" | "threadKey">): SendJob {
  return {
    creatorId: "c-1",
    body: "hola",
    at: 1_000,
    state: "queued",
    ...patch,
  };
}

test("la cola del hilo va en orden y un hilo no bloquea a otro", () => {
  const jobs = [
    job({ clientId: "a1", threadKey: "hilo-a", at: 1, state: "sending" }),
    job({ clientId: "a2", threadKey: "hilo-a", at: 2 }),
    job({ clientId: "b1", threadKey: "hilo-b", creatorId: "c-2", at: 3 }),
  ];
  assert.deepEqual(runnableJobIds(jobs), ["b1"]);
  const after = jobs.map((item) => item.clientId === "a1" ? { ...item, state: "sent" as const } : item);
  assert.deepEqual(runnableJobIds(after), ["a2", "b1"]);
});

test("si uno falla, los siguientes de ese hilo esperan y el otro hilo no", () => {
  const jobs = [
    job({ clientId: "a1", threadKey: "hilo-a", state: "error" }),
    job({ clientId: "a2", threadKey: "hilo-a", at: 2 }),
    job({ clientId: "b1", threadKey: "hilo-b", at: 3 }),
  ];
  assert.deepEqual(runnableJobIds(jobs), ["b1"]);
  const retried = jobs.map((item) => item.clientId === "a1" ? { ...item, state: "queued" as const } : item);
  assert.deepEqual(runnableJobIds(retried), ["a1", "b1"]);
  assert.equal(runnableJobIds(retried).includes("a2"), false);
});

test("un doble Enter con el mismo cuerpo en menos de un segundo es un solo envío", () => {
  const first = acceptSend([], { clientId: "1", creatorId: "c-1", threadKey: "hilo", body: "hola", at: 5_000 }, 5_000);
  assert.equal(first.accepted, true);
  const second = acceptSend(first.jobs, { clientId: "2", creatorId: "c-1", threadKey: "hilo", body: "hola", at: 5_400 }, 5_400);
  assert.equal(second.accepted, false);
  assert.equal(second.jobs.length, 1);
  assert.equal(second.jobs[0]?.clientId, "1");
  const other = acceptSend(first.jobs, { clientId: "3", creatorId: "c-1", threadKey: "hilo", body: "otro", at: 5_200 }, 5_200);
  assert.equal(other.accepted, true);
  const later = acceptSend(first.jobs, { clientId: "4", creatorId: "c-1", threadKey: "hilo", body: "hola", at: 6_000 }, 6_000);
  assert.equal(later.accepted, true);
  const anotherThread = acceptSend(first.jobs, { clientId: "5", creatorId: "c-1", threadKey: "otro", body: "hola", at: 5_100 }, 5_100);
  assert.equal(anotherThread.accepted, true);
});

test("la burbuja optimista se sustituye por el mensaje real y no se duplica", () => {
  const local = [
    { clientId: "b1", creatorId: "c-1", threadKey: "hilo", body: "hola", messageId: "m-1" },
    { clientId: "b1", creatorId: "c-1", threadKey: "hilo", body: "hola", messageId: "m-1" },
    { clientId: "b2", creatorId: "c-1", threadKey: "hilo", body: "sigo", messageId: null },
  ];
  const shown = reconcileBubbles(local, [
    { messageKey: "m-1", creatorId: "c-1", threadKey: "hilo" },
  ]);
  assert.deepEqual(shown.map((item) => item.clientId), ["b2"]);
  const pending = pendingBesideLocal([
    { id: "b2", creatorId: "c-1", threadKey: "hilo", body: "sigo" },
    { id: "srv", creatorId: "c-1", threadKey: "hilo", body: "viejo" },
  ], shown);
  assert.deepEqual(pending.map((item) => item.id), ["srv"]);
});

test("Enter envía y Mayúsculas+Enter no", () => {
  assert.equal(enterSendsMessage("Enter", false, false), true);
  assert.equal(enterSendsMessage("Enter", true, false), false);
  assert.equal(enterSendsMessage("Enter", false, true), false);
  assert.equal(enterSendsMessage("a", false, false), false);
});

test("la burbuja de un hilo no aparece en otro hilo ni en otra creadora", () => {
  const pending = [
    { id: "a", creatorId: "c-1", threadKey: "hilo", body: "uno" },
    { id: "b", creatorId: "c-2", threadKey: "hilo", body: "dos" },
    { id: "c", creatorId: "c-1", threadKey: "otro", body: "tres" },
  ];
  assert.deepEqual(pendingForThread(pending, { creatorId: "c-1", threadKey: "hilo" }).map((item) => item.id), ["a"]);
  assert.deepEqual(pendingForThread(pending, { creatorId: "c-2", threadKey: "hilo" }).map((item) => item.body), ["dos"]);
  assert.deepEqual(pendingForThread(pending, { creatorId: "c-1", threadKey: "otro" }).map((item) => item.id), ["c"]);
});

test("un error ya guardado frena el hilo hasta que ese id se reintenta", () => {
  const holds = [{ clientId: "a1", creatorId: "c-1", threadKey: "hilo-a" }];
  const waiting = [job({ clientId: "a2", threadKey: "hilo-a", at: 2 })];
  assert.deepEqual(runnableJobIds(waiting, holds), []);
  const retried = [
    job({ clientId: "a1", threadKey: "hilo-a", at: 1, state: "queued" }),
    ...waiting,
  ];
  assert.deepEqual(runnableJobIds(retried, holds), ["a1"]);
  const sent = retried.map((item) => item.clientId === "a1" ? { ...item, state: "sent" as const } : item);
  assert.deepEqual(runnableJobIds(sent, []), ["a2"]);
});

test("la burbuja dice Enviando, Pendiente de confirmar o No se envió", () => {
  assert.equal(bubbleCaption("queued", null), "Enviando…");
  assert.equal(bubbleCaption("sending", null), "Enviando…");
  assert.equal(bubbleCaption("awaiting", null), "Pendiente de confirmar");
  assert.equal(bubbleCaption("error", "Envío real desactivado"), "No se envió: Envío real desactivado");
  assert.equal(bubbleCaption("error", "  "), "No se envió: No se envió");
  assert.equal(bubbleCaption("sent", null), null);
});

test("beforeunload avisa mientras la cola del navegador no está vacía", () => {
  assert.equal(shouldWarnOnLeave([]), false);
  assert.equal(shouldWarnOnLeave([job({ clientId: "1", threadKey: "h", state: "queued" })]), true);
  assert.equal(shouldWarnOnLeave([job({ clientId: "1", threadKey: "h", state: "sending" })]), true);
  assert.equal(shouldWarnOnLeave([job({ clientId: "1", threadKey: "h", state: "error" })]), true);
  assert.equal(shouldWarnOnLeave([job({ clientId: "1", threadKey: "h", state: "sent" })]), false);
  assert.equal(shouldWarnOnLeave([job({ clientId: "1", threadKey: "h", state: "awaiting" })]), false);
  assert.equal(shouldWarnOnLeave([
    job({ clientId: "1", threadKey: "h", state: "sent" }),
    job({ clientId: "2", threadKey: "h", state: "queued" }),
  ]), true);
});

test("un rechazo recupera el borrador con texto, precio y piezas", () => {
  const restored = draftFromRejected({
    body: "mira",
    priceCents: 500,
    priceLabel: "$5.00",
    vault: [{ id: "v1", name: "playa" }],
  });
  assert.equal(restored.body, "mira");
  assert.equal(restored.priceCents, 500);
  assert.equal(restored.priceLabel, "$5.00");
  assert.deepEqual(restored.vault, [{ id: "v1", name: "playa" }]);
  restored.vault.push({ id: "otro", name: "no" });
  const again = draftFromRejected({
    body: "mira",
    priceCents: 500,
    priceLabel: "$5.00",
    vault: [{ id: "v1", name: "playa" }],
  });
  assert.equal(again.vault.length, 1);
});

test("solo el error del propio usuario frena el hilo", () => {
  const items = [
    { id: "ajeno", creatorId: "c-1", threadKey: "hilo", status: "error", authorId: "otro" },
    { id: "mio", creatorId: "c-1", threadKey: "hilo", status: "error", authorId: "yo" },
    { id: "espera", creatorId: "c-1", threadKey: "hilo", status: "pending", authorId: "yo" },
  ];
  assert.deepEqual(holdsForUser(items, "yo").map((hold) => hold.clientId), ["mio"]);
  assert.deepEqual(holdsForUser(items, "otro").map((hold) => hold.clientId), ["ajeno"]);
  assert.deepEqual(holdsForUser(items, null), []);
  const waiting = [job({ clientId: "siguiente", threadKey: "hilo", at: 2 })];
  assert.deepEqual(runnableJobIds(waiting, holdsForUser(items, "otro")), []);
  assert.deepEqual(runnableJobIds(waiting, holdsForUser(items, "yo")), []);
  assert.deepEqual(runnableJobIds(waiting, holdsForUser(items, "nadie")), ["siguiente"]);
});

test("descartar sin ok no saca el envío de la cola", () => {
  const jobs = [job({ clientId: "a", threadKey: "hilo", state: "error" })];
  const denied = applyDiscardResult(jobs, "a", { ok: false });
  assert.equal(denied.length, 1);
  assert.equal(denied[0]?.clientId, "a");
  assert.equal(applyDiscardResult(jobs, "a", { ok: true }).length, 0);
});

test("recuperar un pendiente del servidor conserva precio y piezas", () => {
  const draft = draftFromPending({
    body: "mira",
    priceCents: 500,
    vault: [{ id: "v1", name: "playa" }],
  });
  assert.equal(draft.body, "mira");
  assert.equal(draft.priceCents, 500);
  assert.equal(draft.priceLabel, "$5.00");
  assert.deepEqual(draft.vault, [{ id: "v1", name: "playa" }]);
  assert.equal(draftFromPending({ body: "gratis", priceCents: null, vault: [] }).priceLabel, null);
});
