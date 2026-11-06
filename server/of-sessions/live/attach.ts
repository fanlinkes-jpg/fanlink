import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { LIVE_MAX_PAYLOAD, liveUpgradeAllowed } from "./desk.ts";
import { acceptLiveSocket } from "./room.ts";

const attached = new WeakSet<Server>();

/** Engancha el WebSocket en el servidor de desarrollo, sin tocar el HMR de Vite. */
export function attachLiveView(server: Server): void {
  if (attached.has(server)) return;
  attached.add(server);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: LIVE_MAX_PAYLOAD });
  server.on("upgrade", (request, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      return;
    }
    if (url.pathname !== "/api/live-view") return;
    if (!liveUpgradeAllowed(request.url ?? "/", request.headers.origin, request.headers.host)) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      void acceptLiveSocket(ws).catch(() => {
        ws.close();
      });
    });
  });
}
