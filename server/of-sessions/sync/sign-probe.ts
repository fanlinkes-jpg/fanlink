/**
 * Sonda de solo lectura. Compara dos firmas contra OnlyFans y no cambia
 * el corte de `signOnlyfans`: A firma el id real y manda user-id; B firma
 * con 0 y no manda esa cabecera. La salida es ruta, variante y estado.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { decryptBytes } from "../crypto.ts";
import { loadConfig } from "../config.ts";
import { parseStorageState } from "../sessions/storage-state.ts";
import { AccountStore } from "../store/account-store.ts";
import type { Account } from "../types.ts";
import { sessionForApi } from "./of-chat-api.ts";
import { loadSignRules, normalizeHeaderName, signOnlyfans, type SignRules } from "./of-sign.ts";

export const PROBE_PATHS = ["/api2/v2/users/me", "/api2/v2/users/notifications/count"] as const;
export const PROBE_GAP_MS = 1_000;
const HOST = "https://onlyfans.com";

export type ProbeVariant = "A" | "B";

type ProbeAuth = { cookie: string; userId: string; xBc: string };

export function readProbeAccount(argv: readonly string[]): string {
  const index = argv.indexOf("--account");
  const inline = argv.find((item) => item.startsWith("--account="));
  const value = index >= 0 ? argv[index + 1] : inline?.slice("--account=".length);
  if (!value || value.startsWith("-")) throw new Error("Falta --account.");
  return value.trim();
}

export function probeLine(route: string, variant: ProbeVariant, status: number | "error"): string {
  if (!route.startsWith("/api2/v2/") || route.includes("?") || route.includes(" ") || route.includes("#")) {
    throw new Error("La sonda solo acepta una ruta de api2 sin query.");
  }
  const code = status === "error" ? "error" : String(status);
  if (!/^(error|\d{3})$/.test(code)) throw new Error("El estado de la sonda no es un HTTP.");
  return `${route} ${variant} ${code}`;
}

export function probeHeaders(
  rules: SignRules,
  route: string,
  auth: ProbeAuth,
  variant: ProbeVariant,
  timeMs: number,
): Record<string, string> {
  if (route.includes("?") || route.includes("#")) throw new Error("La sonda solo acepta una ruta de api2 sin query.");
  const signed = variant === "A"
    ? signOnlyfans(rulesWithoutUserId(rules), route, auth.userId, timeMs)
    : signOnlyfans(rules, route, "0", timeMs);
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "app-token": rules.appToken,
    cookie: auth.cookie,
    sign: signed.sign,
    time: signed.time,
    "user-agent": BROWSER_FINGERPRINT.userAgent,
    "x-bc": auth.xBc,
    referer: "https://onlyfans.com/",
  };
  if (variant === "A") headers["user-id"] = auth.userId;
  for (const name of rules.removeHeaders) {
    const key = normalizeHeaderName(name);
    if (variant === "A" && key === "user-id") continue;
    delete headers[key];
  }
  if (variant === "B") delete headers["user-id"];
  return headers;
}

export async function executeSignProbe(input: {
  account: string;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  stdout: (line: string) => void;
  rules?: SignRules;
}): Promise<void> {
  const config = loadConfig(input.env);
  if (!config.sessionKey) throw new Error("Falta FANLINK_SESSION_KEY.");
  const auth = await loadProbeAuth(config.dataDir, input.account, config.sessionKey, input.now());
  const rules = input.rules ?? await loadSignRules(input.fetch, input.now());
  let first = true;
  for (const route of PROBE_PATHS) {
    for (const variant of ["A", "B"] as const) {
      if (!first) await input.sleep(PROBE_GAP_MS);
      first = false;
      const status = await probeGet(input.fetch, route, probeHeaders(rules, route, auth, variant, input.now()));
      input.stdout(probeLine(route, variant, status));
    }
  }
}

async function probeGet(fetchImpl: typeof fetch, route: string, headers: Record<string, string>): Promise<number | "error"> {
  try {
    const response = await fetchImpl(`${HOST}${route}`, { method: "GET", headers, redirect: "manual" });
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  } catch {
    return "error";
  }
}

async function loadProbeAuth(dataDir: string, accountToken: string, sessionKey: Buffer, nowMs: number): Promise<ProbeAuth> {
  const store = new AccountStore(path.join(dataDir, "accounts.json"));
  await store.init();
  const account = findAccount(await store.list(), accountToken);
  if (!account) throw new Error("No hay una cuenta con ese id.");
  const file = path.join(dataDir, "sessions", `${account.id}.json`);
  let raw: Buffer;
  try {
    raw = await readFile(file);
  } catch {
    throw new Error("Esa cuenta no tiene sesión guardada.");
  }
  const state = parseStorageState(JSON.parse(decryptBytes(raw, sessionKey).toString("utf8")) as unknown);
  const auth = sessionForApi(state, nowMs);
  if ("reason" in auth) throw new Error(auth.reason);
  return auth;
}

function findAccount(accounts: Account[], token: string): Account | undefined {
  const needle = token.trim().replace(/^@/, "");
  return accounts.find((item) => item.creatorId === needle)
    ?? accounts.find((item) => item.identityHandle?.replace(/^@/, "").toLowerCase() === needle.toLowerCase())
    ?? accounts.find((item) => item.id === needle);
}

function rulesWithoutUserId(rules: SignRules): SignRules {
  return {
    ...rules,
    removeHeaders: rules.removeHeaders.filter((name) => normalizeHeaderName(name) !== "user-id"),
  };
}

const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  executeSignProbe({
    account: readProbeAccount(process.argv),
    env: process.env,
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    stdout: (line) => console.log(line),
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "No se pudo hacer la sonda.";
    console.error(message);
    process.exitCode = 1;
  });
}
