import { useEffect, useRef, useState, type MouseEvent, type WheelEvent } from "react";
import { ComingSoonPage } from "@/features/coming-soon-page";
import { openLiveView } from "@/lib/of-sessions";

type LiveStatus = { type: "status"; role: "control" | "view"; send: boolean };

export function LiveOfViewer({ creatorId, section }: { creatorId: string; section: "notifications" }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const statusRef = useRef<LiveStatus | null>(null);
  const [message, setMessage] = useState("Abriendo la página de OnlyFans…");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    const frameUrl = { current: null as string | null };

    const disconnect = () => {
      socket?.close();
      socket = null;
      socketRef.current = null;
      if (frameUrl.current) URL.revokeObjectURL(frameUrl.current);
      frameUrl.current = null;
    };

    const start = async () => {
      setReady(false);
      setMessage("Abriendo la página de OnlyFans…");
      const result = await openLiveView({ data: { creatorId, section } }).catch(() => ({
        ok: false as const,
        ticket: null,
        reason: "No se ha podido abrir la vista nativa.",
      }));
      if (cancelled) return;
      if (!result.ok || !result.ticket) {
        setMessage(explainLiveReason(result.reason));
        return;
      }
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/live-view`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        if (cancelled || !socket) return;
        socket.send(JSON.stringify({ type: "auth", ticket: result.ticket }));
      });
      socket.addEventListener("message", (event) => {
        if (cancelled) return;
        if (typeof event.data === "string") {
          try {
            const payload = JSON.parse(event.data) as { type?: string; reason?: string; role?: "control" | "view"; send?: boolean };
            if (payload.type === "bye") {
              setReady(false);
              setMessage(payload.reason || "La vista nativa se ha cerrado.");
              return;
            }
            if (payload.type === "status" && payload.role) {
              statusRef.current = { type: "status", role: payload.role, send: Boolean(payload.send) };
            }
          } catch {
            // Un estado irreconocible no se enseña ni se registra.
          }
          return;
        }
        const canvas = canvasRef.current;
        if (!canvas || !(event.data instanceof ArrayBuffer)) return;
        const blob = new Blob([event.data], { type: "image/jpeg" });
        const next = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
          if (frameUrl.current) URL.revokeObjectURL(frameUrl.current);
          frameUrl.current = next;
          canvas.width = image.naturalWidth || 1100;
          canvas.height = image.naturalHeight || 720;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(image, 0, 0);
          setReady(true);
          setMessage("");
        };
        image.onerror = () => URL.revokeObjectURL(next);
        image.src = next;
      });
      socket.addEventListener("close", () => {
        if (cancelled) return;
        setReady(false);
        setMessage((current) => current || "La conexión con la vista nativa se ha cerrado.");
      });
    };

    void start();
    return () => {
      cancelled = true;
      disconnect();
    };
  }, [creatorId, section]);

  const sendInput = (payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  };

  const point = (event: MouseEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    return {
      x: event.nativeEvent.offsetX,
      y: event.nativeEvent.offsetY,
      canvasWidth: canvas.clientWidth,
      canvasHeight: canvas.clientHeight,
    };
  };

  const canType = statusRef.current?.role === "control" && statusRef.current.send;

  if (!ready && message && message !== "Abriendo la página de OnlyFans…") {
    return <ComingSoonPage title="Notificaciones" hint={message} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0c100f]">
      {message ? <p className="shrink-0 px-4 py-2 text-sm text-white/80">{message}</p> : null}
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Página de notificaciones de OnlyFans"
        className="min-h-0 flex-1 w-full cursor-crosshair bg-black object-contain outline-none"
        style={{ display: ready || message ? "block" : "block" }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.currentTarget.focus();
          sendInput({ type: "mouse", action: "down", button: "left", ...point(event) });
        }}
        onMouseUp={(event) => sendInput({ type: "mouse", action: "up", button: "left", ...point(event) })}
        onMouseMove={(event) => {
          if (event.buttons === 0) {
            sendInput({ type: "mouse", action: "move", ...point(event) });
            return;
          }
          sendInput({ type: "mouse", action: "move", button: "left", ...point(event) });
        }}
        onWheel={(event) => {
          event.preventDefault();
          sendInput({ type: "wheel", deltaX: event.deltaX, deltaY: event.deltaY, ...point(event) });
        }}
        onKeyDown={(event) => {
          if (!canType) return;
          event.preventDefault();
          sendInput({ type: "key", key: event.key, code: event.code, down: true });
        }}
        onKeyUp={(event) => {
          if (!canType) return;
          event.preventDefault();
          sendInput({ type: "key", key: event.key, code: event.code, down: false });
        }}
      />
    </div>
  );
}

function explainLiveReason(reason: string | null | undefined): string {
  if (!reason || reason === "Vista en directo desactivada") {
    return "La vista nativa de Notificaciones está apagada. Activa FANLINK_LIVE_VIEW_ENABLED y añade la cuenta a FANLINK_SEND_ALLOW_ACCOUNTS para ver la página real de OnlyFans.";
  }
  if (reason === "Esta cuenta no tiene la vista en directo.") {
    return "Esta creadora no está en la lista de cuentas con vista nativa (FANLINK_SEND_ALLOW_ACCOUNTS).";
  }
  return reason;
}
