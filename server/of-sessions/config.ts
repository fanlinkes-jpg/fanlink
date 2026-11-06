import path from "node:path";
import { readSessionKey } from "./crypto.ts";

export interface FanlinkConfig {
  dataDir: string;
  host: string;
  port: number;
  /** Login interactivo. La app real siempre abre una ventana visible. */
  headlessLogin: boolean;
  /** Si OnlyFans rechaza la sesión, reabrir la ventana para la persona. */
  openLoginOnInvalidate: boolean;
  loginTimeoutMs: number;
  probeTimeoutMs: number;
  /** Tras networkidle, cuánto se espera a que la página pida al usuario actual. */
  identityWaitMs: number;
  /** Pausa entre scroll y páginas al sincronizar. Una cuenta cada vez. */
  syncPaceMs: number;
  /** Clave AES-256-GCM. Null si FANLINK_SESSION_KEY no está definida: no se escribe la sesión en claro. */
  sessionKey: Buffer | null;
}

export interface DisplayEnv {
  platform: NodeJS.Platform;
  display?: string;
  wayland?: string;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): FanlinkConfig {
  const port = env.PORT ? Number(env.PORT) : 8787;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT tiene que ser un entero entre 0 y 65535");
  }
  const loginTimeoutMs = env.FANLINK_LOGIN_TIMEOUT_MS
    ? Number(env.FANLINK_LOGIN_TIMEOUT_MS)
    : FIFTEEN_MINUTES;
  if (!Number.isFinite(loginTimeoutMs) || loginTimeoutMs < 1000) {
    throw new Error(
      "FANLINK_LOGIN_TIMEOUT_MS tiene que ser un número de milisegundos >= 1000",
    );
  }
  return {
    dataDir: path.resolve(env.FANLINK_DATA_DIR ?? path.join(cwd, "data")),
    host: env.HOST?.trim() || "127.0.0.1",
    port,
    headlessLogin: false,
    openLoginOnInvalidate: env.FANLINK_OPEN_LOGIN_ON_INVALIDATE !== "false",
    loginTimeoutMs,
    probeTimeoutMs: 30_000,
    identityWaitMs: 15_000,
    syncPaceMs: 1_200,
    sessionKey: readSessionKey(env.FANLINK_SESSION_KEY),
  };
}

/**
 * Configuración del CRM. La ventana solo se abre con Conectar o Reconectar,
 * salvo que FANLINK_OPEN_LOGIN_ON_INVALIDATE sea exactamente "true".
 */
export function loadCrmSessionConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): FanlinkConfig {
  const config = loadConfig(env, cwd);
  return {
    ...config,
    headlessLogin: false,
    openLoginOnInvalidate: env.FANLINK_OPEN_LOGIN_ON_INVALIDATE === "true",
  };
}

export function currentDisplayEnv(): DisplayEnv {
  return {
    platform: process.platform,
    display: process.env.DISPLAY,
    wayland: process.env.WAYLAND_DISPLAY,
  };
}
