import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { clearAccountChatPace, withAccountApi } from "../sync/api-list-pace.ts";
import { parseSignRules } from "../sync/of-sign.ts";
import { readJsonBody } from "../sync/of-sign.ts";
import { sendPerMinute } from "../send/gate.ts";
import { onlineDedupeKey } from "../send/online-claim.ts";
import {
  canSeeOnlineFans,
  cancelOnlineBroadcast,
  clearOnlineBroadcastPace,
  onlineChatId,
  onlineMessageBody,
  onlineMessagePath,
  onlineRecipients,
  onlineSendGapMs,
  sendOnlineBroadcast,
  type OnlineBroadcastInput,
  type OnlineSendStatus,
} from "../send/online-broadcast.ts";

const account = { creatorId: "3zk7kbr", accountId: "acc-1", handle: null, userId: "42", label: "Prueba" };
const other = { ...account, creatorId: "otra", accountId: "acc-2" };

test("con el flag apagado no hay POST, y fuera de la lista tampoco", async () => {
  clearOnlineBroadcastPace();
  let posts = 0;
  const fetchImpl: typeof fetch = async () => {
    posts += 1;
    return Response.json({ id: 1 });
  };
  const off = await sendOnlineBroadcast(input(fetchImpl, { FANLINK_ENABLE_SEND: "true", FANLINK_ENABLE_MASS_SEND: "true", FANLINK_SEND_ALLOW_ACCOUNTS: "3zk7kbr" }));
  assert.equal(off.posted, 0);
  assert.equal(off.reason, "Envío a todos desactivado");
  const sendOff = await sendOnlineBroadcast(input(fetchImpl, { FANLINK_ENABLE_ONLINE_BROADCAST: "true", FANLINK_SEND_ALLOW_ACCOUNTS: "3zk7kbr" }));
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

test("solo se escribe a quien sigue en línea y el POST usa el id del fan", async () => {
  clearOnlineBroadcastPace();
  const urls: string[] = [];
  const headers: Array<Headers> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    urls.push(String(url));
    headers.push(new Headers(init?.headers));
    return Response.json({ id: 9 });
  };
  const sent = await sendOnlineBroadcast({
    ...input(fetchImpl, openEnv()),
    requested: ["1", "9", "1"],
    online: [{ fanKey: "1" }, { fanKey: "2" }],
  });
  assert.deepEqual(urls, [`https://onlyfans.com${onlineMessagePath("1")}`]);
  assert.equal(headers[0]?.get("user-id"), null);
  const rules = parseSignRules({
    static_param: "param",
    format: "1:{}:{:x}:2",
    checksum_indexes: [0, 1],
    checksum_constant: 10,
    app_token: "token",
    remove_headers: ["user-id"],
  });
  assert.ok(rules);
  const hash = createHash("sha1").update(["param", "1700000000000", onlineMessagePath("1"), "0"].join("\n")).digest("hex");
  const checksum = hash.charCodeAt(0) + hash.charCodeAt(1) + 10;
  assert.equal(headers[0]?.get("sign"), `1:${hash}:${Math.abs(checksum).toString(16)}:2`);
  assert.equal(sent.posted, 1);
  assert.equal(sent.results.find((row) => row.fanKey === "9")?.reason, "Ya no está en línea");
  assert.equal(onlineChatId("1"), "1");
  assert.equal(onlineChatId("hilo-no"), null);
  assert.equal(onlineRecipients(["1", "9"], [{ fanKey: "1" }]).send.length, 1);
});

test("el mismo lote no vuelve a enviar a quien ya recibió el mensaje", async () => {
  clearOnlineBroadcastPace();
  let posts = 0;
  const done = new Set<string>();
  const fetchImpl: typeof fetch = async () => {
    posts += 1;
    return Response.json({ id: posts });
  };
  const first = await sendOnlineBroadcast(input(fetchImpl, openEnv(), account, {
    claim: async (fanKey) => ({ state: done.has(fanKey) ? "enviado" as const : "nuevo" as const, id: fanKey }),
    finish: async (fanKey, status) => {
      if (status === "enviado") done.add(fanKey);
    },
  }));
  assert.equal(first.posted, 2);
  const second = await sendOnlineBroadcast(input(fetchImpl, openEnv(), account, {
    claim: async (fanKey) => ({ state: done.has(fanKey) ? "enviado" as const : "nuevo" as const, id: fanKey }),
    finish: async (fanKey, status) => {
      if (status === "enviado") done.add(fanKey);
    },
  }));
  assert.equal(posts, 2);
  assert.equal(second.posted, 0);
  assert.deepEqual(second.results.map((row) => row.status), ["enviado", "enviado"]);
});

test("el ritmo es el de FANLINK_SEND_PER_MINUTE y no se solapa con pullList", async () => {
  clearOnlineBroadcastPace();
  clearAccountChatPace();
  let clock = 0;
  const waits: number[] = [];
  let posts = 0;
  let inPost = false;
  let pullBetween = false;
  const paced = await sendOnlineBroadcast({
    ...input(async () => {
      inPost = true;
      posts += 1;
      inPost = false;
      return Response.json({ id: posts });
    }, { ...openEnv(), FANLINK_SEND_PER_MINUTE: "2" }, account, undefined, "acc-pace"),
    requested: ["1", "2", "3"],
    online: [{ fanKey: "1" }, { fanKey: "2" }, { fanKey: "3" }],
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      if (waits.length === 1) {
        assert.equal(inPost, false);
        assert.equal(posts, 1);
        await withAccountApi("acc-pace", async () => {
          pullBetween = true;
          assert.equal(inPost, false);
        });
      }
      clock += ms;
    },
  });
  assert.equal(paced.posted, 3);
  assert.equal(pullBetween, true);
  assert.deepEqual(waits, [30_000, 30_000]);
  clearOnlineBroadcastPace();
  clearAccountChatPace();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let insidePull = false;
  let overlapped = false;
  const pull = withAccountApi("acc-1", async () => {
    insidePull = true;
    await held;
    insidePull = false;
  });
  const sent = sendOnlineBroadcast({
    ...input(async () => {
      if (insidePull) overlapped = true;
      return Response.json({ id: 1 });
    }, openEnv()),
    requested: ["1"],
    online: [{ fanKey: "1" }],
  });
  await Promise.resolve();
  assert.equal(overlapped, false);
  release();
  await pull;
  const done = await sent;
  assert.equal(overlapped, false);
  assert.equal(done.posted, 1);
});

test("un 429 corta la cola y deja el retryAfter", async () => {
  clearOnlineBroadcastPace();
  let posts = 0;
  const fetchImpl: typeof fetch = async () => {
    posts += 1;
    if (posts === 2) return new Response("no", { status: 429, headers: { "retry-after": "12" } });
    return Response.json({ id: posts });
  };
  const sent = await sendOnlineBroadcast({
    ...input(fetchImpl, openEnv(), account, undefined, "acc-429"),
    requested: ["1", "2", "3", "4"],
    online: ["1", "2", "3", "4"].map((fanKey) => ({ fanKey })),
  });
  assert.equal(posts, 2);
  assert.equal(sent.posted, 1);
  assert.equal(sent.stopped, true);
  assert.equal(sent.retryAfter, 12);
  assert.equal(sent.results.filter((row) => row.reason === "OnlyFans pide esperar.").length, 3);
});

test("un fallo de un fan no borra el resultado de los demás", async () => {
  clearOnlineBroadcastPace();
  let posts = 0;
  const fetchImpl: typeof fetch = async () => {
    posts += 1;
    if (posts === 2) return new Response("no", { status: 500 });
    return Response.json({ id: posts });
  };
  const sent = await sendOnlineBroadcast({
    ...input(fetchImpl, openEnv(), account, undefined, "acc-partial"),
    requested: ["1", "2", "3"],
    online: ["1", "2", "3"].map((fanKey) => ({ fanKey })),
  });
  assert.equal(posts, 3);
  assert.equal(sent.posted, 2);
  assert.equal(sent.stopped, false);
  assert.deepEqual(sent.results.map((row) => row.status), ["enviado", "fallido", "enviado"]);
});

test("cancelar el lote deja constancia de a quién le llegó", async () => {
  clearOnlineBroadcastPace();
  let posts = 0;
  let release: () => void = () => undefined;
  let secondStarted: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    secondStarted = resolve;
  });
  const sent = sendOnlineBroadcast({
    ...input(async (_url, init) => {
      posts += 1;
      if (posts === 1) return Response.json({ id: 1 });
      secondStarted();
      await gate;
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return Response.json({ id: 2 });
    }, openEnv(), account, undefined, "acc-cancel"),
    batchId: "lote-1",
    requested: ["1", "2", "3"],
    online: ["1", "2", "3"].map((fanKey) => ({ fanKey })),
  });
  await started;
  assert.equal(cancelOnlineBroadcast("lote-1", "chatter", "3zk7kbr"), true);
  release();
  const done = await sent;
  assert.equal(done.results.find((row) => row.fanKey === "1")?.status, "enviado");
  assert.equal(done.results.filter((row) => row.reason === "Cancelado").length, 2);
  assert.equal(posts, 2);
});

test("101 destinatarios se quedan en el tope y el cuerpo es el del bundle", async () => {
  clearOnlineBroadcastPace();
  let clock = 0;
  let posts = 0;
  let body: unknown;
  const fans = Array.from({ length: 101 }, (_, index) => String(index + 1));
  const sent = await sendOnlineBroadcast({
    ...input(async (_url, init) => {
      posts += 1;
      body ??= JSON.parse(String(init?.body));
      return Response.json({ id: posts });
    }, { ...openEnv(), FANLINK_SEND_PER_MINUTE: "30" }, account, undefined, "acc-cap"),
    requested: fans,
    online: fans.map((fanKey) => ({ fanKey })),
    mediaIds: [44],
    priceCents: 960,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  assert.equal(onlineRecipients(fans, fans.map((fanKey) => ({ fanKey }))).capped, true);
  assert.equal(sent.posted, 100);
  assert.equal(sent.cap, 100);
  assert.equal(sent.reason, "Tope de 100");
  assert.equal(posts, 100);
  assert.deepEqual(body, onlineMessageBody({ text: "hola", mediaIds: [44], price: 9.6 }));
});

test("dos lotes a la vez respetan el hueco de 60/N", async () => {
  clearOnlineBroadcastPace();
  clearAccountApiLock();
  let clock = 0;
  const stamps: number[] = [];
  const env = { ...openEnv(), FANLINK_SEND_PER_MINUTE: "4" };
  const fetchImpl: typeof fetch = async () => {
    stamps.push(clock);
    return Response.json({ id: stamps.length });
  };
  const pace = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
  await Promise.all([
    sendOnlineBroadcast({ ...input(fetchImpl, env, account, undefined, "acc-gap"), requested: ["1"], online: [{ fanKey: "1" }], ...pace }),
    sendOnlineBroadcast({ ...input(fetchImpl, env, account, undefined, "acc-gap"), batchId: "lote-b", requested: ["2"], online: [{ fanKey: "2" }], ...pace }),
  ]);
  stamps.sort((left, right) => left - right);
  assert.equal(stamps.length, 2);
  assert.ok((stamps[1] ?? 0) - (stamps[0] ?? 0) >= onlineSendGapMs(4));
});

test("el ritmo por defecto es 4 y el tope es 30", () => {
  assert.notEqual(onlineDedupeKey({ text: "hola", priceCents: null, mediaIds: [] }), onlineDedupeKey({ text: "hola", priceCents: 500, mediaIds: [3] }));
  assert.equal(sendPerMinute(undefined), 4);
  assert.equal(sendPerMinute(""), 4);
  assert.equal(sendPerMinute("30"), 30);
  assert.equal(sendPerMinute("31"), 4);
  assert.equal(sendPerMinute("0"), 4);
});

test("una fila en sending no se reenvía", async () => {
  clearOnlineBroadcastPace();
  let posts = 0;
  const sent = await sendOnlineBroadcast({
    ...input(async () => {
      posts += 1;
      return Response.json({ id: 1 });
    }, openEnv(), account, {
      claim: async (fanKey) => ({ state: "comprobar" as const, id: fanKey }),
    }, "acc-sending"),
    requested: ["1"],
    online: [{ fanKey: "1" }],
  });
  assert.equal(posts, 0);
  assert.equal(sent.results[0]?.reason, "Hay que comprobar si salió");
});

test("un chatter solo ve las cuentas que tiene asignadas", () => {
  const chatter = { role: "member" as const, perms: ["mensajes"], creatorIds: ["3zk7kbr"] };
  assert.equal(canSeeOnlineFans(chatter, "3zk7kbr"), true);
  assert.equal(canSeeOnlineFans(chatter, "otra"), false);
  assert.equal(canSeeOnlineFans({ role: "member", perms: [], creatorIds: ["3zk7kbr"] }, "3zk7kbr"), false);
  assert.equal(canSeeOnlineFans({ role: "owner", perms: [], creatorIds: [] }, "otra"), true);
});

test("readJsonBody cancela el cuerpo al cumplirse el tope", async () => {
  let cancelled = false;
  await assert.rejects(
    readJsonBody({
      json: () => new Promise(() => undefined),
      body: { cancel: async () => { cancelled = true; } },
    }, 30),
    (error: unknown) => error instanceof Error && error.name === "TimeoutError",
  );
  assert.equal(cancelled, true);
});

function openEnv(): NodeJS.ProcessEnv {
  return { FANLINK_ENABLE_SEND: "true", FANLINK_ENABLE_ONLINE_BROADCAST: "true", FANLINK_SEND_ALLOW_ACCOUNTS: "3zk7kbr" };
}

function input(
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv,
  target = account,
  hooks?: {
    claim?: (fanKey: string) => Promise<{ state: "nuevo" | "enviado" | "comprobar"; id: string }>;
    finish?: (id: string, status: OnlineSendStatus) => Promise<void>;
  },
  accountId = target.accountId ?? "acc-1",
): OnlineBroadcastInput {
  const rules = parseSignRules({
    static_param: "param",
    format: "1:{}:{:x}:2",
    checksum_indexes: [0, 1],
    checksum_constant: 10,
    app_token: "token",
    remove_headers: ["user-id"],
  });
  if (!rules) throw new Error("reglas");
  let clock = 1_700_000_000_000;
  return {
    env,
    account: { ...target, accountId },
    userId: "chatter",
    batchId: "lote",
    auth: { cookie: "auth_id=42; sess=ok", userId: "42", xBc: "huella" },
    rules,
    requested: ["1", "2"],
    online: [{ fanKey: "1" }, { fanKey: "2" }],
    text: "hola",
    mediaIds: [],
    priceCents: null,
    vaultReason: null,
    fetch: fetchImpl,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    claim: hooks?.claim ?? (async (fanKey) => ({ state: "nuevo" as const, id: fanKey })),
    finish: async (id, status) => {
      await hooks?.finish?.(id, status);
    },
  };
}
