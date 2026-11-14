import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSignRules } from "../sync/of-sign.ts";
import {
  ONLINE_SEND_GAP_MS,
  canSeeOnlineFans,
  clearOnlineBroadcastPace,
  onlineMessagePath,
  sendOnlineBroadcast,
  type OnlineBroadcastInput,
} from "../send/online-broadcast.ts";

const account = { creatorId: "3zk7kbr", accountId: "acc-1", handle: null, userId: "42", label: "Prueba" };
const other = { ...account, creatorId: "otra", accountId: "acc-2" };

test("con el flag apagado no hay POST, y fuera de la lista tampoco", async () => {
  clearOnlineBroadcastPace();
  let posts = 0;
  const fetchImpl: typeof fetch = async () => {
    posts += 1;
    return Response.json({});
  };
  const off = await sendOnlineBroadcast(input(fetchImpl, { FANLINK_ENABLE_SEND: "true", FANLINK_SEND_ALLOW_ACCOUNTS: "3zk7kbr" }));
  assert.equal(off.posted, 0);
  assert.equal(off.reason, "Envío a todos desactivado");
  const sendOff = await sendOnlineBroadcast(input(fetchImpl, { FANLINK_ENABLE_MASS_SEND: "true", FANLINK_SEND_ALLOW_ACCOUNTS: "3zk7kbr" }));
  assert.equal(sendOff.posted, 0);
  assert.equal(sendOff.reason, "Envío real desactivado");
  const outsider = await sendOnlineBroadcast(input(fetchImpl, openEnv(), other));
  assert.equal(outsider.posted, 0);
  assert.equal(outsider.reason, "Esta cuenta no puede enviar.");
  const cheap = await sendOnlineBroadcast({ ...input(fetchImpl, openEnv()), priceCents: 100 });
  assert.equal(cheap.reason, "Mínimo $3 USD o gratis");
  const blocked = await sendOnlineBroadcast({ ...input(fetchImpl, openEnv()), vaultReason: "NO VENDER" });
  assert.equal(blocked.reason, "NO VENDER");
  assert.equal(posts, 0);
});

test("con el flag y la cuenta permitida hay un POST por fan, a 300 ms y uno en vuelo", async () => {
  clearOnlineBroadcastPace();
  let clock = 1_700_000_000_000;
  let pending = 0;
  let maxPending = 0;
  const starts: number[] = [];
  const bodies: unknown[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    pending += 1;
    maxPending = Math.max(maxPending, pending);
    starts.push(clock);
    assert.equal(init?.method, "POST");
    assert.equal(String(url), `https://onlyfans.com${onlineMessagePath(String(starts.length))}`);
    bodies.push(JSON.parse(String(init?.body)));
    pending -= 1;
    return Response.json({ id: starts.length });
  };
  const sent = await sendOnlineBroadcast({
    ...input(fetchImpl, openEnv()),
    fans: [{ fanKey: "1" }, { fanKey: "2" }, { fanKey: "3" }],
    mediaIds: [44],
    priceCents: 960,
    now: () => clock,
    sleep: async (ms) => {
      assert.equal(ms, ONLINE_SEND_GAP_MS);
      clock += ms;
    },
  });
  assert.equal(sent.posted, 3);
  assert.equal(sent.reason, null);
  assert.deepEqual(sent.results.map((row) => row.status), ["enviado", "enviado", "enviado"]);
  assert.deepEqual(starts, [1_700_000_000_000, 1_700_000_000_300, 1_700_000_000_600]);
  assert.equal(maxPending, 1);
  assert.equal((bodies[0] as { price: number }).price, 9.6);
  assert.deepEqual((bodies[0] as { mediaFiles: number[] }).mediaFiles, [44]);
  assert.equal((bodies[0] as { text: string }).text, "hola");
});

test("dos envíos de la misma cuenta no se cruzan", async () => {
  clearOnlineBroadcastPace();
  let clock = 0;
  let pending = 0;
  let maxPending = 0;
  const starts: number[] = [];
  const fetchImpl: typeof fetch = async () => {
    pending += 1;
    maxPending = Math.max(maxPending, pending);
    starts.push(clock);
    pending -= 1;
    return Response.json({});
  };
  const base = input(fetchImpl, openEnv());
  const pace = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
  await Promise.all([
    sendOnlineBroadcast({ ...base, fans: [{ fanKey: "1" }, { fanKey: "2" }], ...pace }),
    sendOnlineBroadcast({ ...base, fans: [{ fanKey: "3" }], ...pace }),
  ]);
  assert.equal(maxPending, 1);
  assert.deepEqual(starts, [0, 300, 600]);
});

test("un 429 corta la cola y deja el retryAfter", async () => {
  clearOnlineBroadcastPace();
  let posts = 0;
  const fetchImpl: typeof fetch = async () => {
    posts += 1;
    if (posts === 2) return new Response("no", { status: 429, headers: { "retry-after": "12" } });
    return Response.json({});
  };
  const sent = await sendOnlineBroadcast({
    ...input(fetchImpl, openEnv()),
    fans: [{ fanKey: "1" }, { fanKey: "2" }, { fanKey: "3" }, { fanKey: "4" }],
    now: () => posts,
    sleep: async () => undefined,
  });
  assert.equal(posts, 2);
  assert.equal(sent.posted, 1);
  assert.equal(sent.stopped, true);
  assert.equal(sent.retryAfter, 12);
  assert.equal(sent.results.length, 2);
  assert.equal(sent.results[1]?.status, "fallido");
  assert.equal(sent.results[1]?.reason, "OnlyFans pide esperar.");
});

test("un fallo de un fan no borra el resultado de los demás", async () => {
  clearOnlineBroadcastPace();
  let posts = 0;
  const fetchImpl: typeof fetch = async () => {
    posts += 1;
    if (posts === 2) return new Response("no", { status: 500 });
    return Response.json({});
  };
  const sent = await sendOnlineBroadcast({
    ...input(fetchImpl, openEnv()),
    fans: [{ fanKey: "1" }, { fanKey: "2" }, { fanKey: "3" }],
    now: () => posts,
    sleep: async () => undefined,
  });
  assert.equal(posts, 3);
  assert.equal(sent.posted, 2);
  assert.equal(sent.stopped, false);
  assert.deepEqual(sent.results.map((row) => row.status), ["enviado", "fallido", "enviado"]);
  assert.equal(sent.results[1]?.reason, "No se pudo leer.");
});

test("un chatter solo ve las cuentas que tiene asignadas", () => {
  const chatter = { role: "member" as const, perms: ["mensajes"], creatorIds: ["3zk7kbr"] };
  assert.equal(canSeeOnlineFans(chatter, "3zk7kbr"), true);
  assert.equal(canSeeOnlineFans(chatter, "otra"), false);
  assert.equal(canSeeOnlineFans({ role: "member", perms: [], creatorIds: ["3zk7kbr"] }, "3zk7kbr"), false);
  assert.equal(canSeeOnlineFans({ role: "owner", perms: [], creatorIds: [] }, "otra"), true);
});

function openEnv(): NodeJS.ProcessEnv {
  return { FANLINK_ENABLE_SEND: "true", FANLINK_ENABLE_MASS_SEND: "true", FANLINK_SEND_ALLOW_ACCOUNTS: "3zk7kbr" };
}

function input(fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, target = account): OnlineBroadcastInput {
  const rules = parseSignRules({
    static_param: "param",
    format: "1:{}:{:x}:2",
    checksum_indexes: [0, 1],
    checksum_constant: 10,
    app_token: "token",
  });
  if (!rules) throw new Error("reglas");
  return {
    env,
    account: target,
    auth: { cookie: "auth_id=42; sess=ok", userId: "42", xBc: "huella" },
    rules,
    fans: [{ fanKey: "1" }, { fanKey: "2" }],
    text: "hola",
    mediaIds: [],
    priceCents: null,
    vaultReason: null,
    fetch: fetchImpl,
    now: () => 1_700_000_000_000,
    sleep: async () => undefined,
  };
}
