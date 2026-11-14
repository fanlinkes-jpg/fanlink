import assert from "node:assert/strict";
import { test } from "node:test";
import { clearAccountChatPace } from "../sync/api-list-pace.ts";
import { clearUnreadMarks } from "../sync/chat-store.ts";
import { clearMarkReadJobs, markOpenedChat, markReadPath } from "../sync/mark-read.ts";
import { parseSignRules, signOnlyfans } from "../sync/of-sign.ts";
import { signedHeaders } from "../sync/of-chat-api.ts";
import type { ReadSql } from "../sync/store.ts";
import type { SendAccount } from "../send/gate.ts";

const SECRET = "sess-mark-secret";
const TIME = 1_700_000_000_000;
const account: SendAccount = {
  creatorId: "3zk7kbr",
  accountId: "acc-1",
  handle: "crea",
  userId: "42",
  label: "Crea",
};

test("con el flag y la cuenta, abrir manda un POST firmado y un 200 deja el unread en 0", async () => {
  const rules = rulesOf();
  const path = markReadPath("99");
  assert.equal(path, "/api2/v2/chats/99/mark-as-read");
  assert.equal(markReadPath("mark-as-read"), null);
  const auth = { cookie: `auth_id=42; sess=${SECRET}`, userId: "42", xBc: "huella" };
  const calls: Array<{ url: string; method: string | undefined; body: unknown; sign: string }> = [];
  const logs: string[] = [];
  let unread: number | null = 4;
  let updates = 0;
  const sql = memorySql(() => unread, () => {
    unread = 0;
    updates += 1;
  });
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = init?.headers as Record<string, string>;
    calls.push({ url: String(url), method: init?.method, body: init?.body, sign: headers.sign ?? "" });
    return new Response("no imprimir", { status: 200 });
  };
  try {
    const first = await markOpenedChat(input(sql, fetchImpl, logs, rules, auth));
    const again = await markOpenedChat(input(sql, fetchImpl, logs, rules, auth));
    assert.equal(first.posted, true);
    assert.equal(first.status, 200);
    assert.equal(again.posted, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://onlyfans.com/api2/v2/chats/99/mark-as-read");
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.body, undefined);
    assert.equal(calls[0]?.sign, signOnlyfans(rules, path ?? "", "42", TIME).sign);
    assert.equal(calls[0]?.sign, signedHeaders(rules, path ?? "", auth, TIME).sign);
    assert.equal(updates, 1);
    assert.equal(unread, 0);
    assert.deepEqual(logs, ["[fanlink:chat] ruta=mark-as-read status=200"]);
    assert.equal(logs.join("").includes("99"), false);
    assert.equal(logs.join("").includes(SECRET), false);
    assert.equal(logs.join("").includes(calls[0]?.sign ?? "sign"), false);
  } finally {
    clearMarkReadJobs();
    clearUnreadMarks();
    clearAccountChatPace();
  }
});

test("abrir dos veces a la vez no repite el POST", async () => {
  const rules = rulesOf();
  let fetches = 0;
  let unread: number | null = 3;
  const sql = memorySql(() => unread, () => {
    unread = 0;
  });
  const fetchImpl: typeof fetch = async () => {
    fetches += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(null, { status: 200 });
  };
  try {
    const [left, right] = await Promise.all([
      markOpenedChat(input(sql, fetchImpl, [], rules, authOf())),
      markOpenedChat(input(sql, fetchImpl, [], rules, authOf())),
    ]);
    assert.equal(left.status, 200);
    assert.equal(right.status, 200);
    assert.equal(fetches, 1);
  } finally {
    clearMarkReadJobs();
    clearUnreadMarks();
    clearAccountChatPace();
  }
});

test("el flag apagado, otra cuenta o un fallo no mandan un 0 inventado", async () => {
  const rules = rulesOf();
  let fetches = 0;
  let unread: number | null = 4;
  let updates = 0;
  const logs: string[] = [];
  const sql = memorySql(() => unread, () => {
    updates += 1;
    unread = 0;
  });
  const fetchImpl: typeof fetch = async () => {
    fetches += 1;
    return new Response(null, { status: 400 });
  };
  try {
    const off = await markOpenedChat({ ...input(sql, fetchImpl, logs, rules, authOf()), flag: undefined });
    const outsider = await markOpenedChat({
      ...input(sql, fetchImpl, logs, rules, authOf()),
      account: { ...account, creatorId: "otra", handle: "otra", userId: "1", accountId: "acc-otra", label: "Otra" },
    });
    assert.equal(off.posted, false);
    assert.equal(outsider.posted, false);
    assert.equal(fetches, 0);
    const failed = await markOpenedChat(input(sql, fetchImpl, logs, rules, authOf()));
    assert.equal(failed.posted, true);
    assert.equal(failed.status, 400);
    assert.equal(fetches, 1);
    assert.equal(updates, 0);
    assert.equal(unread, 4);
    assert.deepEqual(logs, ["[fanlink:chat] ruta=mark-as-read status=400"]);
  } finally {
    clearMarkReadJobs();
    clearUnreadMarks();
    clearAccountChatPace();
  }
});

function rulesOf() {
  const rules = parseSignRules({
    static_param: "param",
    format: "1:{}:{:x}:2",
    checksum_indexes: [0, 1],
    checksum_constants: [4, 6],
    checksum_constant: 10,
    app_token: "token",
    remove_headers: ["user-id"],
  });
  if (!rules) throw new Error("reglas");
  return rules;
}

function authOf() {
  return { cookie: `auth_id=42; sess=${SECRET}`, userId: "42", xBc: "huella" };
}

function input(
  sql: ReadSql,
  fetchImpl: typeof fetch,
  logs: string[],
  rules: ReturnType<typeof rulesOf>,
  auth: { cookie: string; userId: string; xBc: string },
) {
  return {
    accountId: "acc-1",
    creatorId: "3zk7kbr",
    threadKey: "99",
    flag: "true",
    allowlist: "3zk7kbr",
    account,
    sql,
    fetch: fetchImpl,
    now: () => TIME,
    sleep: async () => undefined,
    rules,
    auth,
    log: (line: string) => logs.push(line),
  };
}

function memorySql(read: () => number | null, write: () => void): ReadSql {
  return {
    async query<T>(text: string): Promise<T[]> {
      if (text.startsWith("select")) return [{ unread: read() }] as T[];
      if (text.startsWith("update")) write();
      return [];
    },
  };
}
