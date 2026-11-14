import assert from "node:assert/strict";
import { test } from "node:test";
import type { Account } from "../types.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { clearAccountPauses } from "../sync/backoff.ts";
import { clearSignRulesCache } from "../sync/of-sign.ts";
import { fetchSignedVault } from "../sync/of-chat-api.ts";
import { SESSION_EXPIRED_LABEL } from "../sync/session-link.ts";
import { readChatVaultView } from "../sync/vault-read.ts";

const RULES = {
  static_param: "param",
  format: "1:{}:{:x}:2",
  checksum_indexes: [0, 1],
  checksum_constants: [5, 5],
  checksum_constant: 10,
  app_token: "token",
  remove_headers: ["user-id"],
};

test("la bóveda distingue 401, 400 y 429 y no dice vacío", async () => {
  clearSignRulesCache();
  clearAccountPauses();
  const lines: string[] = [];
  const previous = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  const marked: number[] = [];
  try {
    const denied = await readVault(401, marked);
    assert.equal(denied.reason, SESSION_EXPIRED_LABEL);
    assert.equal(denied.items.length, 0);
    assert.deepEqual(marked, [401]);
    assert.equal(lines.some((line) => line === "[fanlink:vault] creator=9ikis52 status=401"), true);

    marked.length = 0;
    const signature = await readVault(400, marked);
    assert.equal(signature.reason, "OnlyFans ha rechazado la firma");
    assert.notEqual(signature.reason, "Sin datos");
    assert.equal(lines.some((line) => line.includes("creator=9ikis52 status=400")), true);

    const limited = await readVault(429, marked);
    assert.equal(limited.reason, "OnlyFans respondió 429");
    assert.equal(limited.reason?.includes("Sin datos"), false);
    assert.equal(limited.reason?.includes("vacío"), false);

    const direct = await fetchSignedVault(storedState(), {
      fetch: fetchStatus(200),
      now: () => 1,
    });
    assert.equal(direct.status, 200);
    assert.equal(direct.sessionRejected, false);
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearAccountPauses();
  }
});

async function readVault(status: number, marked: number[]) {
  return readChatVaultView({ creatorId: "9ikis52", threadKey: "t" }, {
    fetch: fetchStatus(status),
    now: () => 1,
    sql: { async query() { throw new Error("no sql"); } },
    access: { role: "owner", perms: [] },
    sessions: {
      async listAccounts() {
        return [{ id: "acc-9", creatorId: "9ikis52", hasStorageState: true } as Account];
      },
      async readStorageState() {
        return storedState();
      },
      async borrowProfile() {
        throw new Error("chromium");
      },
      async noteRouteRejection(_id, _reason, _epoch) {
        marked.push(401);
        return true;
      },
    },
  });
}

function fetchStatus(status: number): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("dynamic-rules")) return Response.json(RULES);
    if (status === 200) return Response.json({ list: [{ id: 1, type: "photo" }] });
    return new Response("no", { status, headers: status === 429 ? { "retry-after": "2" } : undefined });
  }) as typeof fetch;
}

function storedState(): StorageStateFile {
  return {
    cookies: [
      { name: "auth_id", value: "42", domain: ".onlyfans.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
      { name: "sess", value: "ok", domain: ".onlyfans.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
    ],
    origins: [{ origin: "https://onlyfans.com", localStorage: [{ name: "bcTokenSha", value: "huella" }] }],
  };
}
