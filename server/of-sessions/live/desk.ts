import { accountOnAllowlist, allowTokens, type SendAccount } from "../send/gate.ts";

export type LiveRole = "control" | "view";

export function liveFps(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return 4;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 8) return 4;
  return value;
}

export function liveQuality(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return 40;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 20 || value > 80) return 40;
  return value;
}

/** Teclear en la pestaña es enviar. Mismo candado que el envío: flag y allowlist. */
export function liveViewGate(
  flag: string | undefined,
  allowlist: string | undefined,
  account: SendAccount,
): { allowed: boolean; reason: string } {
  if (flag !== "true") return { allowed: false, reason: "Vista en directo desactivada" };
  if (allowTokens(allowlist).length === 0 || !accountOnAllowlist(allowlist, account)) {
    return { allowed: false, reason: "Esta cuenta no tiene la vista en directo." };
  }
  return { allowed: true, reason: "" };
}

/** Solo OnlyFans y su CDN. data:, blob: y about: son de la propia pestaña. */
export function liveRequestAllowed(raw: string): boolean {
  if (raw.startsWith("data:") || raw.startsWith("blob:") || raw.startsWith("about:")) return true;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return host === "onlyfans.com" || host.endsWith(".onlyfans.com");
  } catch {
    return false;
  }
}

export function mapPointer(
  offsetX: number,
  offsetY: number,
  canvas: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const x = Math.round((offsetX * viewport.width) / width);
  const y = Math.round((offsetY * viewport.height) / height);
  return {
    x: Math.min(Math.max(0, x), Math.max(0, viewport.width - 1)),
    y: Math.min(Math.max(0, y), Math.max(0, viewport.height - 1)),
  };
}

const KEY_CODE: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
};

export type DeskCommand =
  | { method: "Input.dispatchMouseEvent"; params: Record<string, unknown> }
  | { method: "Input.dispatchKeyEvent"; params: Record<string, unknown> }
  | { method: "Input.insertText"; params: { text: string } }
  | { method: "resize"; params: { width: number; height: number } };

export type DeskInput =
  | { type: "mouse"; action: "down" | "up" | "move"; x: number; y: number; canvasWidth: number; canvasHeight: number; button?: "left" | "right" | "middle" }
  | { type: "wheel"; x: number; y: number; canvasWidth: number; canvasHeight: number; deltaX: number; deltaY: number }
  | { type: "key"; key: string; code: string; down: boolean }
  | { type: "text"; text: string }
  | { type: "resize"; width: number; height: number };

/** Traduce el canvas al viewport. El texto solo va a insertText, nunca al log. */
export function deskCommand(input: DeskInput, viewport: { width: number; height: number }): DeskCommand | null {
  if (input.type === "resize") {
    const width = Math.min(1920, Math.max(320, Math.round(input.width)));
    const height = Math.min(1200, Math.max(240, Math.round(input.height)));
    return { method: "resize", params: { width, height } };
  }
  if (input.type === "text") {
    if (!input.text) return null;
    return { method: "Input.insertText", params: { text: input.text.slice(0, 4000) } };
  }
  if (input.type === "wheel") {
    const point = mapPointer(input.x, input.y, { width: input.canvasWidth, height: input.canvasHeight }, viewport);
    return {
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseWheel", x: point.x, y: point.y, deltaX: input.deltaX, deltaY: input.deltaY },
    };
  }
  if (input.type === "mouse") {
    const point = mapPointer(input.x, input.y, { width: input.canvasWidth, height: input.canvasHeight }, viewport);
    const type = input.action === "down" ? "mousePressed" : input.action === "up" ? "mouseReleased" : "mouseMoved";
    return {
      method: "Input.dispatchMouseEvent",
      params: {
        type,
        x: point.x,
        y: point.y,
        button: input.button ?? "left",
        clickCount: input.action === "move" ? 0 : 1,
      },
    };
  }
  const code = KEY_CODE[input.key];
  if (code || input.key.length !== 1) {
    return {
      method: "Input.dispatchKeyEvent",
      params: {
        type: input.down ? "keyDown" : "keyUp",
        key: input.key,
        code: input.code || input.key,
        windowsVirtualKeyCode: code ?? 0,
        nativeVirtualKeyCode: code ?? 0,
      },
    };
  }
  if (!input.down) {
    return { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: input.key, code: input.code || `Key${input.key.toUpperCase()}` } };
  }
  return { method: "Input.insertText", params: { text: input.key } };
}

export function claimControl(holder: string | null, userId: string): { role: LiveRole; holder: string } {
  if (holder == null || holder === userId) return { role: "control", holder: userId };
  return { role: "view", holder };
}

export function releaseControl(holder: string | null, userId: string, waiting: readonly string[]): { holder: string | null; next: string | null } {
  if (holder !== userId) return { holder, next: null };
  const next = waiting.find((id) => id !== userId) ?? null;
  return { holder: next, next };
}

/** El log no incluye lo tecleado. */
export function liveLog(kind: "inicio" | "fin" | "control" | "error", fields: { accountId: string; userId?: string | null; fps?: number; detail?: string }): string {
  const who = fields.userId ? ` control=${fields.userId}` : "";
  const fps = fields.fps != null ? ` fps=${fields.fps}` : "";
  const detail = fields.detail ? ` ${fields.detail.slice(0, 120)}` : "";
  return `[fanlink:live] ${kind} cuenta=${fields.accountId}${who}${fps}${detail}`;
}
