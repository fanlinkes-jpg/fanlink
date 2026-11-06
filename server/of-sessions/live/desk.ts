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

const LIVE_CHAT_PREFIXES = ["/my/chats", "/api2/v2/chats", "/api2/v2/messages"] as const;
const LIVE_DENIED_SEGMENTS = [
  "statements", "statistics", "banking", "payouts", "payout", "settings",
  "payments", "billing", "wallet", "cards", "bank", "earnings", "invoices",
] as const;

/** Solo el chat y sus mensajes. Statements, estadísticas, banca, pagos y ajustes no pasan. */
export function liveRequestAllowed(raw: string): boolean {
  if (raw.startsWith("data:") || raw.startsWith("blob:") || raw.startsWith("about:")) return true;
  let url: URL;
  try {
    url = new URL(raw, "https://onlyfans.com");
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "wss:" && url.protocol !== "ws:") return false;
  const host = url.hostname.toLowerCase();
  if (host !== "onlyfans.com" && !host.endsWith(".onlyfans.com")) return false;
  let path = url.pathname.toLowerCase();
  try {
    path = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (path.includes("..") || path.includes("\\")) return false;
  const segments = path.split("/").filter(Boolean);
  if (segments.some((part) => (LIVE_DENIED_SEGMENTS as readonly string[]).includes(part))) return false;
  if (host !== "onlyfans.com" && host !== "www.onlyfans.com") return true;
  if (path === "/" || LIVE_CHAT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return true;
  return /\.(js|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|mp4|m4s|m3u8|ts|aac|mp3|webm)$/.test(path);
}

/** El mismo filtro, dentro de la página, para pushState y window.open. */
export function liveHistoryGuardSource(): string {
  const allow = JSON.stringify({ prefixes: LIVE_CHAT_PREFIXES, denied: LIVE_DENIED_SEGMENTS });
  return `(() => {
    const allow = ${allow};
    const ok = (raw) => {
      try {
        const url = new URL(String(raw), location.origin);
        const host = url.hostname.toLowerCase();
        if (host !== "onlyfans.com" && !host.endsWith(".onlyfans.com")) return false;
        const path = decodeURIComponent(url.pathname).toLowerCase();
        const parts = path.split("/").filter(Boolean);
        if (parts.some((part) => allow.denied.includes(part))) return false;
        if (host !== "onlyfans.com" && host !== "www.onlyfans.com") return true;
        if (path === "/" || allow.prefixes.some((prefix) => path === prefix || path.startsWith(prefix + "/"))) return true;
        return /\\.(js|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|mp4|m4s|m3u8|ts|aac|mp3|webm)$/.test(path);
      } catch { return false; }
    };
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    history.pushState = (state, title, url) => {
      if (url != null && !ok(url)) return;
      return push(state, title, url);
    };
    history.replaceState = (state, title, url) => {
      if (url != null && !ok(url)) return;
      return replace(state, title, url);
    };
    const open = window.open.bind(window);
    window.open = (url, target, features) => {
      if (url != null && !ok(url)) return null;
      return open(url, target, features);
    };
  })();`;
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

/** Traduce el canvas al viewport. Sin envío real no hay teclado ni texto. */
export function deskCommand(input: DeskInput, viewport: { width: number; height: number }, typing = true): DeskCommand | null {
  if (!typing && (input.type === "key" || input.type === "text")) return null;
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

/** Teclear y subir archivos solo si el envío real está encendido. */
export function liveTypingEnabled(flag: string | undefined = process.env.FANLINK_ENABLE_SEND): boolean {
  return flag === "true";
}

export const LIVE_MAX_VIEWERS = 4;
export const LIVE_MAX_PAYLOAD = 1024 * 1024;
export const LIVE_EVENTS_PER_SECOND = 40;

export function liveRoomKey(accountId: string, threadKey: string): string {
  return `${accountId}\n${threadKey}`;
}

export function liveViewerAccepted(count: number, max = LIVE_MAX_VIEWERS): boolean {
  return count < max;
}

/** El origen del socket tiene que ser esta misma app. El ticket no viaja en la URL. */
export function liveOriginAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    const expected = host.split(",")[0]?.trim() ?? "";
    return url.host === expected;
  } catch {
    return false;
  }
}

export function liveUpgradeAllowed(requestUrl: string, origin: string | undefined, host: string | undefined): boolean {
  let url: URL;
  try {
    url = new URL(requestUrl, "http://127.0.0.1");
  } catch {
    return false;
  }
  if (url.pathname !== "/api/live-view") return false;
  if (url.searchParams.has("ticket")) return false;
  return liveOriginAllowed(origin, host);
}

export type LiveClientEvent =
  | DeskInput
  | { type: "file"; name: string; mime: string; data: string }
  | { type: "release" }
  | { type: "claim" }
  | { type: "auth"; ticket: string };

/** El evento del cliente tiene que encajar en el esquema. Si no, se ignora. */
export function parseLiveEvent(raw: string): LiveClientEvent | null {
  if (raw.length === 0 || raw.length > LIVE_MAX_PAYLOAD) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  switch (event.type) {
    case "auth":
      if (typeof event.ticket !== "string" || event.ticket.length < 10 || event.ticket.length > 80) return null;
      return { type: "auth", ticket: event.ticket };
    case "release":
      return { type: "release" };
    case "claim":
      return { type: "claim" };
    case "text":
      if (typeof event.text !== "string" || event.text.length === 0 || event.text.length > 4000) return null;
      return { type: "text", text: event.text };
    case "resize":
      if (!isFiniteNumber(event.width) || !isFiniteNumber(event.height)) return null;
      return { type: "resize", width: event.width, height: event.height };
    case "key":
      if (typeof event.key !== "string" || typeof event.code !== "string" || typeof event.down !== "boolean") return null;
      if (event.key.length > 20 || event.code.length > 30) return null;
      return { type: "key", key: event.key, code: event.code, down: event.down };
    case "wheel":
      if (!isFiniteNumber(event.x) || !isFiniteNumber(event.y) || !isFiniteNumber(event.canvasWidth) || !isFiniteNumber(event.canvasHeight)) return null;
      if (!isFiniteNumber(event.deltaX) || !isFiniteNumber(event.deltaY)) return null;
      return {
        type: "wheel",
        x: event.x,
        y: event.y,
        canvasWidth: event.canvasWidth,
        canvasHeight: event.canvasHeight,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      };
    case "mouse":
      if (event.action !== "down" && event.action !== "up" && event.action !== "move") return null;
      if (!isFiniteNumber(event.x) || !isFiniteNumber(event.y) || !isFiniteNumber(event.canvasWidth) || !isFiniteNumber(event.canvasHeight)) return null;
      const button = event.button === "left" || event.button === "right" || event.button === "middle" ? event.button : undefined;
      if (event.button != null && !button) return null;
      return {
        type: "mouse",
        action: event.action,
        x: event.x,
        y: event.y,
        canvasWidth: event.canvasWidth,
        canvasHeight: event.canvasHeight,
        button,
      };
    case "file":
      if (typeof event.name !== "string" || typeof event.mime !== "string" || typeof event.data !== "string") return null;
      if (event.data.length > 700_000) return null;
      return { type: "file", name: event.name.slice(0, 120), mime: event.mime.slice(0, 80), data: event.data };
    default:
      return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function takeLiveEventSlot(stamps: number[], now: number, limit = LIVE_EVENTS_PER_SECOND): boolean {
  const fresh = stamps.filter((stamp) => now - stamp < 1_000);
  stamps.length = 0;
  stamps.push(...fresh);
  if (stamps.length >= limit) return false;
  stamps.push(now);
  return true;
}

/** Sin el flag de envío, el controlador no teclea, no pulsa Enter y no sube archivos. */
export function liveControlAllowed(typing: boolean, role: LiveRole, kind: LiveClientEvent["type"]): boolean {
  if (kind === "auth") return false;
  if (kind === "release") return role === "control";
  if (kind === "claim") return role === "view";
  if (role !== "control") return false;
  if (!typing && (kind === "key" || kind === "text" || kind === "file")) return false;
  return true;
}

/** El timeout suelta el control y deja a quien solo mira. */
export function releaseIdleController(holder: string | null, waiting: readonly string[]): { holder: string | null; next: string | null; closeViewers: false } {
  if (!holder) return { holder: null, next: null, closeViewers: false };
  const freed = releaseControl(holder, holder, waiting);
  return { holder: freed.holder, next: freed.next, closeViewers: false };
}
