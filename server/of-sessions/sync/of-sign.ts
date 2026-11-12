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

let cached: { rules: SignRules; at: number } | null = null;

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
  if (checksumConstants.length > 0 && checksumConstants.length !== checksumIndexes.length) return null;
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
  if (cached && now - cached.at < 30 * 60_000) return cached.rules;
  const response = await fetchImpl(RULES_URL);
  if (!response.ok) throw new Error("no hay reglas de firma");
  const rules = parseSignRules(await response.json());
  if (!rules) throw new Error("reglas de firma ilegibles");
  cached = { rules, at: now };
  return rules;
}

/** Firma una ruta. El tiempo va en milisegundos y el id es el de la cuenta. */
export function signOnlyfans(rules: SignRules, pathWithQuery: string, userId: string, timeMs: number): { sign: string; time: string } {
  const time = String(timeMs);
  const hash = createHash("sha1").update([rules.staticParam, time, pathWithQuery, userId].join("\n")).digest("hex");
  const checksum = rules.checksumIndexes.reduce((sum, index) => sum + hash.charCodeAt(index), rules.checksumConstant);
  const sign = rules.format.replace("{}", hash).replace("{:x}", Math.abs(checksum).toString(16));
  return { sign, time };
}
