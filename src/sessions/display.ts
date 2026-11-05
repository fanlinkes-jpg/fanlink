import type { DisplayEnv } from "../config.js";
import { messages } from "../messages.js";

export function assertLoginDisplay(headless: boolean, env: DisplayEnv): void {
  if (headless) return;
  if (env.platform === "win32" || env.platform === "darwin") return;
  if (env.display || env.wayland) return;
  throw new Error(messages.displayRequired);
}
