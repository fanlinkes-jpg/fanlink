import { createFileRoute } from "@tanstack/react-router";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { loadCrmSessionConfig } from "../../../server/of-sessions/config.ts";
import { canProxyMedia, decodeMedia } from "../../../server/of-sessions/sync/history.ts";

export const Route = createFileRoute("/api/chat-media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await requireUserId();
        const url = new URL(request.url);
        const creatorId = url.searchParams.get("creatorId") ?? "";
        const messageKey = url.searchParams.get("messageKey") ?? "";
        const index = Number(url.searchParams.get("index") ?? "0");
        if (!creatorId || !messageKey || !Number.isInteger(index) || index < 0) {
          return new Response("Sin datos", { status: 404 });
        }
        const bytes = await loadPreview(creatorId, messageKey, index);
        if (!bytes) return new Response("Sin datos", { status: 404 });
        return new Response(Buffer.from(bytes), { headers: { "content-type": sniff(bytes), "cache-control": "private, max-age=86400" } });
      },
    },
  },
});

async function loadPreview(creatorId: string, messageKey: string, index: number): Promise<Uint8Array | null> {
  const cache = cachePath(creatorId, messageKey, index);
  const cached = await readFile(cache).catch(() => null);
  if (cached) return cached;
  const sql = await getSql();
  const rows = await sql.query<{ media_json: string | null }>(
    "select media_json from of_chat_message where creator_id = $1 and message_key = $2",
    [creatorId, messageKey],
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
  const direct = await fetch(preview).catch(() => null);
  if (direct?.ok) {
    const bytes = new Uint8Array(await direct.arrayBuffer());
    if (bytes.byteLength > 0 && bytes.byteLength <= 5_000_000) return bytes;
  }
  try {
    const { getOfSessionManager } = await import("@/lib/of-sessions-runtime.server");
    const sessions = await getOfSessionManager();
    const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId);
    if (!account) return null;
    const ran = await sessions.runQueued(account.id, async (context) => {
      const response = await context.request.get(preview, { timeout: 8_000 });
      if (!response.ok()) return null;
      const bytes = new Uint8Array(await response.body());
      return bytes.byteLength > 0 && bytes.byteLength <= 5_000_000 ? bytes : null;
    });
    return ran.ok ? ran.value : null;
  } catch {
    return null;
  }
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
