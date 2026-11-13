import { createHash } from "node:crypto";

export type SignRules = {
  staticParam: string;
  format: string;
  checksumIndexes: number[];
  checksumConstants: number[];
  checksumConstant: number;
  appToken: string;
  removeHeaders: string[];
};

const RULES_URL = "https://raw.githubusercontent.com/DATAHOARDERS/dynamic-rules/main/onlyfans.json";
const RULES_TTL_MS = 30 * 60_000;
export const RULES_TIMEOUT_MS = 5_000;

let cached: { rules: SignRules; at: number } | null = null;
let inflight: Promise<SignRules> | null = null;

export function clearSignRulesCache(): void {
  cached = null;
  inflight = null;
}

export function parseSignRules(value: unknown): SignRules | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.static_param !== "string" || typeof raw.format !== "string" || typeof raw.app_token !== "string") return null;
  if (!Array.isArray(raw.checksum_indexes) || typeof raw.checksum_constant !== "number") return null;
  const checksumIndexes = raw.checksum_indexes.filter((item): item is number => Number.isInteger(item));
  if (checksumIndexes.length !== raw.checksum_indexes.length) return null;
  const checksumConstants = Array.isArray(raw.checksum_constants)
    ? raw.checksum_constants.filter((item): item is number => Number.isInteger(item))
    : [];
  if (Array.isArray(raw.checksum_constants) && checksumConstants.length !== raw.checksum_constants.length) return null;
  if (checksumConstants.length > 0 && checksumConstants.length !== checksumIndexes.length) return null;
  if (checksumConstants.length > 0) {
    const sum = checksumConstants.reduce((total, item) => total + item, 0);
    if (sum !== raw.checksum_constant) return null;
  }
  const removeHeaders = Array.isArray(raw.remove_headers)
    ? raw.remove_headers.filter((item): item is string => typeof item === "string")
    : [];
  return {
    staticParam: raw.static_param,
    format: raw.format,
    checksumIndexes,
    checksumConstants,
    checksumConstant: raw.checksum_constant,
    appToken: raw.app_token,
    removeHeaders,
  };
}

export async function loadSignRules(fetchImpl: typeof fetch, now: number): Promise<SignRules> {
  if (cached && now - cached.at < RULES_TTL_MS) return cached.rules;
  if (!inflight) {
    inflight = downloadSignRules(fetchImpl, now).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function downloadSignRules(fetchImpl: typeof fetch, now: number): Promise<SignRules> {
  try {
    const response = await fetchImpl(RULES_URL, { signal: AbortSignal.timeout(RULES_TIMEOUT_MS) });
    if (!response.ok) throw new Error("no hay reglas de firma");
    const rules = parseSignRules(await response.json());
    if (!rules) throw new Error("reglas de firma ilegibles");
    cached = { rules, at: now };
    return rules;
  } catch (error) {
    if (cached) return cached.rules;
    throw error instanceof Error ? error : new Error("no hay reglas de firma");
  }
}

/**
 * Firma una ruta. El tiempo va en milisegundos, como en 3064d53.
 *
 * Checksum = suma de charCode(hash[i]) para i en checksum_indexes, más
 * checksum_constant. No se suman checksum_constants: checksum_constant ya
 * es esa suma (DATAHOARDERS/dynamic-rules 48c8c17, 974 = 974).
 *
 * Ruta con query (todas las de api2 que usamos): el cuarto campo es el id
 * real y la cabecera user-id se manda. Así lo hace UltimaScraperAPI
 * authenticator.py create_signed_headers (si hay query, id real y user-id)
 * y OF-Scraper request.py (user-id de la cuenta dentro del mensaje).
 * remove_headers solo quita user-id en rutas sin query; entonces se firma con 0.
 *
 * El 401 intermitente visto en el Mac con este algoritmo es de la sesión
 * (rotación de sess), no de esta fórmula.
 */
export function signOnlyfans(rules: SignRules, pathWithQuery: string, userId: string, timeMs: number): { sign: string; time: string } {
  const time = String(timeMs);
  const signedUser = signedUserId(rules, pathWithQuery, userId);
  const hash = createHash("sha1").update([rules.staticParam, time, pathWithQuery, signedUser].join("\n")).digest("hex");
  const checksum = rules.checksumIndexes.reduce((sum, index) => {
    const code = hash.charCodeAt(index);
    return sum + (Number.isFinite(code) ? code : 0);
  }, rules.checksumConstant);
  const sign = rules.format.replace("{}", hash).replace("{:x}", Math.abs(checksum).toString(16));
  return { sign, time };
}

export function pathHasQuery(pathWithQuery: string): boolean {
  return pathWithQuery.includes("?");
}

export function signedUserId(rules: SignRules, pathWithQuery: string, userId: string): string {
  if (pathHasQuery(pathWithQuery)) return userId;
  return headerRemoved(rules, "user-id") ? "0" : userId;
}

export function headerRemoved(rules: SignRules, name: string): boolean {
  const needle = normalizeHeaderName(name);
  return rules.removeHeaders.some((item) => normalizeHeaderName(item) === needle);
}

export function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase().replaceAll("_", "-");
}
