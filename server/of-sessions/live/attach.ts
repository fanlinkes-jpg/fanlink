import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { joinLive } from "./room.ts";

const attached = new WeakSet<Server>();

/** Engancha el WebSocket en el servidor de desarrollo, sin tocar el HMR de Vite. */
export function attachLiveView(server: Server): void {
  if (attached.has(server)) return;
  attached.add(server);
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/live-view") return;
    sockets.handleUpgrade(request, socket, head, (ws) => {
      void joinLive(ws, url.searchParams.get("ticket") ?? "").catch((error: unknown) => {
        console.info(`[fanlink:live] error ${error instanceof Error ? error.message.slice(0, 120) : "socket"}`);
        ws.close();
      });
    });
  });
}
