import { createFileRoute } from "@tanstack/react-router";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { creatorIdsForChats } from "@/lib/access-policy";
import { DEV_USER_ID, authConfigured, requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { ensureStaff } from "@/lib/workspace-store";
import { loadCrmSessionConfig } from "../../../server/of-sessions/config.ts";
import { canProxyMedia, decodeMedia, followMedia } from "../../../server/of-sessions/sync/history.ts";
import { canReadChatMedia } from "../../../server/of-sessions/sync/media-access.ts";

export const Route = createFileRoute("/api/chat-media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await requireUserId();
        const url = new URL(request.url);
        const creatorId = url.searchParams.get("creatorId") ?? "";
        const messageKey = url.searchParams.get("messageKey") ?? "";
        const threadKey = url.searchParams.get("threadKey") ?? "";
        const index = Number(url.searchParams.get("index") ?? "0");
        if (!creatorId || !messageKey || !threadKey || !Number.isInteger(index) || index < 0) {
          return new Response("Sin datos", { status: 404 });
        }
        const sql = await getSql();
        const localOpen = !authConfigured && userId === DEV_USER_ID;
        const access = await ensureStaff(sql, userId, localOpen);
        const rows = await sql.query<{ thread_key: string }>(
          "select thread_key from of_chat_message where creator_id = $1 and message_key = $2",
          [creatorId, messageKey],
        );
        const allowed = creatorIdsForChats(access, [creatorId]).includes(creatorId) && canReadChatMedia({
          localOpen,
          role: access.role,
          perms: access.perms,
          creatorId,
          threadKey,
          row: rows[0] ? { creatorId, threadKey: rows[0].thread_key } : null,
        });
        if (!allowed) return new Response("Sin datos", { status: 404 });
        const bytes = await loadPreview(creatorId, messageKey, threadKey, index);
        if (!bytes) return new Response("Sin datos", { status: 404 });
        return new Response(Buffer.from(bytes), { headers: { "content-type": sniff(bytes), "cache-control": "private, max-age=86400" } });
      },
    },
  },
});

async function loadPreview(creatorId: string, messageKey: string, threadKey: string, index: number): Promise<Uint8Array | null> {
  const cache = cachePath(creatorId, messageKey, index);
  const cached = await readFile(cache).catch(() => null);
  if (cached) return cached;
  const sql = await getSql();
  const rows = await sql.query<{ media_json: string | null; thread_key: string }>(
    "select media_json, thread_key from of_chat_message where creator_id = $1 and message_key = $2 and thread_key = $3",
    [creatorId, messageKey, threadKey],
  );
  const media = decodeMedia(rows[0]?.media_json ?? null);
  const preview = media?.[index]?.preview;
  if (!preview || !canProxyMedia(preview)) return null;
  const bytes = await downloadPreview(creatorId, preview);
  if (!bytes) return null;
  await mkdir(path.dirname(cache), { recursive: true });
  await writeFile(cache, bytes);
  return bytes;
}

async function downloadPreview(creatorId: string, preview: string): Promise<Uint8Array | null> {
  const direct = await fetchAllowed(preview);
  if (direct) return direct;
  try {
    const { getOfSessionManager } = await import("@/lib/of-sessions-runtime.server");
    const sessions = await getOfSessionManager();
    const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId);
    if (!account) return null;
    const ran = await sessions.runQueued(account.id, async (context) => {
      return followMedia(preview, async (current) => {
        const response = await context.request.get(current, { timeout: 8_000, maxRedirects: 0 });
        if (response.status() >= 300 && response.status() < 400) {
          return { status: response.status(), location: response.headers().location ?? null, body: null };
        }
        if (!response.ok()) return { status: response.status(), location: null, body: null };
        return { status: response.status(), location: null, body: new Uint8Array(await response.body()) };
      });
    });
    return ran.ok ? ran.value : null;
  } catch {
    return null;
  }
}

async function fetchAllowed(preview: string): Promise<Uint8Array | null> {
  return followMedia(preview, async (current) => {
    const response = await fetch(current, { redirect: "manual" }).catch(() => null);
    if (!response) return { status: 0, location: null, body: null };
    if (response.status >= 300 && response.status < 400) {
      return { status: response.status, location: response.headers.get("location"), body: null };
    }
    if (!response.ok) return { status: response.status, location: null, body: null };
    return { status: response.status, location: null, body: new Uint8Array(await response.arrayBuffer()) };
  });
}

function cachePath(creatorId: string, messageKey: string, index: number): string {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return path.join(loadCrmSessionConfig().dataDir, "media-cache", safe(creatorId), safe(messageKey), String(index));
}

function sniff(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  return "application/octet-stream";
}
