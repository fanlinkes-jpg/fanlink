import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { writeEncryptedSession } from "../crypto.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { AccountStore } from "../store/account-store.ts";
import { parseSignRules, signOnlyfans } from "../sync/of-sign.ts";
import { executeSignProbe, probeHeaders, PROBE_GAP_MS, PROBE_PATHS, readProbeAccount } from "../sync/sign-probe.ts";
import { removeDir, tempDataDir, TEST_SESSION_KEY } from "./helpers.ts";

const SECRET = "sess-probe-secret";
const KEY = TEST_SESSION_KEY.toString("base64");

test("la sonda pide las dos rutas en GET, A y B, y solo imprime ruta, variante y estado", async () => {
  assert.equal(PROBE_GAP_MS >= 1_000, true);
  assert.deepEqual(readProbeAccount(["node", "sign-probe.ts", "--account", "3zk7kbr"]), "3zk7kbr");
  assert.throws(() => readProbeAccount(["node", "sign-probe.ts"]), /Falta --account/);
  const dataDir = await tempDataDir();
  const rules = parseSignRules({
    static_param: "param",
    format: "1:{}:{:x}:2",
    checksum_indexes: [0, 1],
    checksum_constants: [4, 6],
    checksum_constant: 10,
    app_token: "token",
    remove_headers: ["user-id"],
  });
  assert.ok(rules);
  const route = PROBE_PATHS[0];
  const auth = { cookie: `auth_id=42; sess=${SECRET}`, userId: "42", xBc: "huella-probe" };
  const variantA = probeHeaders(rules, route, auth, "A", 1_700_000_000_000);
  const variantB = probeHeaders(rules, route, auth, "B", 1_700_000_000_000);
  assert.equal(variantA["user-id"], "42");
  assert.equal(variantB["user-id"], undefined);
  assert.notEqual(variantA.sign, variantB.sign);
  assert.equal(variantB.sign, signOnlyfans(rules, route, "0", 1_700_000_000_000).sign);
  assert.notEqual(variantA.sign, signOnlyfans(rules, route, "0", 1_700_000_000_000).sign);
  const calls: Array<{ url: string; method: string | undefined; body: unknown; redirect: RequestRedirect | undefined; sign: string; userId: string | undefined }> = [];
  let clock = 0;
  const lines: string[] = [];
  try {
    await mkdir(path.join(dataDir, "sessions"));
    const store = new AccountStore(path.join(dataDir, "accounts.json"));
    await store.init();
    const account = await store.create("Prueba", "3zk7kbr");
    await writeEncryptedSession(path.join(dataDir, "sessions", `${account.id}.json`), storedState(), TEST_SESSION_KEY);
    const fetchImpl: typeof fetch = async (url, init) => {
      const headers = init?.headers as Record<string, string>;
      calls.push({
        url: String(url),
        method: init?.method,
        body: init?.body,
        redirect: init?.redirect,
        sign: headers.sign ?? "",
        userId: headers["user-id"],
      });
      if (calls.length === 3) throw new Error(`boom ${SECRET} ${KEY}`);
      const status = calls.length === 2 ? 400 : 200;
      return new Response("no imprimir", { status });
    };
    await executeSignProbe({
      account: "3zk7kbr",
      env: { FANLINK_SESSION_KEY: KEY, FANLINK_DATA_DIR: dataDir, DECOY: SECRET },
      fetch: fetchImpl,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      stdout: (line) => lines.push(line),
      rules,
    });
  } finally {
    await removeDir(dataDir);
  }
  assert.deepEqual(lines, [
    "/api2/v2/users/me A 200",
    "/api2/v2/users/me B 400",
    "/api2/v2/users/notifications/count A error",
    "/api2/v2/users/notifications/count B 200",
  ]);
  const printed = lines.join("\n");
  assert.equal(printed.includes(SECRET), false);
  assert.equal(printed.includes(KEY), false);
  assert.equal(printed.includes("huella-probe"), false);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://onlyfans.com/api2/v2/users/me",
    "https://onlyfans.com/api2/v2/users/me",
    "https://onlyfans.com/api2/v2/users/notifications/count",
    "https://onlyfans.com/api2/v2/users/notifications/count",
  ]);
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "GET", "GET"]);
  assert.deepEqual(calls.map((call) => call.body), [undefined, undefined, undefined, undefined]);
  assert.deepEqual(calls.map((call) => call.redirect), ["manual", "manual", "manual", "manual"]);
  assert.deepEqual(calls.map((call) => call.userId), ["42", undefined, "42", undefined]);
  assert.equal(calls.some((call) => printed.includes(call.sign)), false);
  assert.equal(clock, PROBE_GAP_MS * 3);
});

test("un 429 para la sonda: imprime esa línea y no sigue", async () => {
  const dataDir = await tempDataDir();
  const rules = parseSignRules({
    static_param: "param",
    format: "1:{}:{:x}:2",
    checksum_indexes: [0, 1],
    checksum_constants: [4, 6],
    checksum_constant: 10,
    app_token: "token",
    remove_headers: ["user-id"],
  });
  assert.ok(rules);
  const lines: string[] = [];
  let calls = 0;
  try {
    await mkdir(path.join(dataDir, "sessions"));
    const store = new AccountStore(path.join(dataDir, "accounts.json"));
    await store.init();
    const account = await store.create("Prueba", "3zk7kbr");
    await writeEncryptedSession(path.join(dataDir, "sessions", `${account.id}.json`), storedState(), TEST_SESSION_KEY);
    await executeSignProbe({
      account: "3zk7kbr",
      env: { FANLINK_SESSION_KEY: KEY, FANLINK_DATA_DIR: dataDir },
      fetch: async () => {
        calls += 1;
        return new Response(null, { status: calls === 1 ? 200 : 429 });
      },
      sleep: async () => undefined,
      now: () => 0,
      stdout: (line) => lines.push(line),
      rules,
    });
  } finally {
    await removeDir(dataDir);
  }
  assert.equal(calls, 2);
  assert.deepEqual(lines, [
    "/api2/v2/users/me A 200",
    "/api2/v2/users/me B 429",
  ]);
});

test("sin FANLINK_SESSION_KEY la sonda no llama a OnlyFans", async () => {
  let called = false;
  await assert.rejects(
    () => executeSignProbe({
      account: "3zk7kbr",
      env: { FANLINK_DATA_DIR: "/tmp/fanlink-probe-sin-clave" },
      fetch: async () => {
        called = true;
        return new Response(null, { status: 200 });
      },
      sleep: async () => undefined,
      now: () => 0,
      stdout: () => undefined,
      rules: parseSignRules({
        static_param: "param",
        format: "1:{}:{:x}:2",
        checksum_indexes: [0, 1],
        checksum_constant: 10,
        app_token: "token",
        remove_headers: ["user-id"],
      }) ?? undefined,
    }),
    /Falta FANLINK_SESSION_KEY/,
  );
  assert.equal(called, false);
});

function storedState(): StorageStateFile {
  return {
    cookies: [
      { name: "auth_id", value: "42", domain: ".onlyfans.com", path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "Lax" },
      { name: "sess", value: SECRET, domain: ".onlyfans.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
    ],
    origins: [{ origin: "https://onlyfans.com", localStorage: [{ name: "bcTokenSha", value: "huella-probe" }] }],
  };
}
