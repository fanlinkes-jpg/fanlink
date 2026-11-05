import path from "node:path";

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
    throw new Error("FANLINK_LOGIN_TIMEOUT_MS tiene que ser un número de milisegundos >= 1000");
  }
  return {
    dataDir: path.resolve(env.FANLINK_DATA_DIR ?? path.join(cwd, "data")),
    host: env.HOST?.trim() || "127.0.0.1",
    port,
    headlessLogin: false,
    openLoginOnInvalidate: env.FANLINK_OPEN_LOGIN_ON_INVALIDATE !== "false",
    loginTimeoutMs,
    probeTimeoutMs: 30_000,
  };
}

export function currentDisplayEnv(): DisplayEnv {
  return {
    platform: process.platform,
    display: process.env.DISPLAY,
    wayland: process.env.WAYLAND_DISPLAY,
  };
}
