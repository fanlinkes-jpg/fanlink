import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { LIVE_PUSH_MS, liveCursorChanged, noteInboxOpen, noteThreadWatch } from "../../../server/of-sessions/sync/live.ts";

export const Route = createFileRoute("/api/chat-live")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await requireUserId();
        const url = new URL(request.url);
        const closeInbox = noteInboxOpen();
        const closeThread = noteThreadWatch(url.searchParams.get("creatorId"), url.searchParams.get("threadKey"));
        const { kickInboxWatch, rememberCreatorAccounts } = await import("@/lib/of-sessions-runtime.server");
        await rememberCreatorAccounts();
        kickInboxWatch();
        const encoder = new TextEncoder();
        let cursor: string | null = null;
        let timer: ReturnType<typeof setInterval> | null = null;
        const stream = new ReadableStream({
          start(controller) {
            const write = (chunk: string) => {
              try {
                controller.enqueue(encoder.encode(chunk));
              } catch {
                // El cliente ya cerró el stream.
              }
            };
            write(`event: ready\ndata: ${JSON.stringify({ pollMs: LIVE_PUSH_MS })}\n\n`);
            timer = setInterval(() => {
              void (async () => {
                if (request.signal.aborted) return;
                const sql = await getSql();
                const rows = await sql.query<{ cursor: string | null }>(
                  `select greatest(
                     (select max(synced_at) from of_chat_message),
                     (select max(updated_at) from of_fan_note)
                   )::text as cursor`,
                );
                const next = rows[0]?.cursor ?? null;
                if (!liveCursorChanged(cursor, next)) return;
                cursor = next;
                write(`event: chats\ndata: ${JSON.stringify({ cursor: next })}\n\n`);
              })().catch(() => undefined);
            }, LIVE_PUSH_MS);
            request.signal.addEventListener("abort", () => {
              if (timer) clearInterval(timer);
              closeInbox();
              closeThread();
              try {
                controller.close();
              } catch {
                // Ya estaba cerrado.
              }
            });
          },
          cancel() {
            if (timer) clearInterval(timer);
            closeInbox();
            closeThread();
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});
