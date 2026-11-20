import { useEffect, useRef, useState, type MouseEvent, type WheelEvent } from "react";
import { ComingSoonPage } from "@/features/coming-soon-page";
import { containedCanvasPoint } from "@/lib/live-pointer";
import { openLiveView } from "@/lib/of-sessions";

type LiveStatus = { type: "status"; role: "control" | "view"; send: boolean };

export function LiveOfViewer({ creatorId, section }: { creatorId: string; section: "notifications" }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const statusRef = useRef<LiveStatus | null>(null);
  const [message, setMessage] = useState("Abriendo la página de OnlyFans…");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    const paint = {
      busy: false,
      pending: null as ArrayBuffer | null,
      draw: async function draw(data: ArrayBuffer): Promise<void> {
        paint.busy = true;
        try {
          const bitmap = await createImageBitmap(new Blob([data], { type: "image/jpeg" }));
          const canvas = canvasRef.current;
          if (canvas && !cancelled) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
            if (!readyOnce.current) {
              readyOnce.current = true;
              setReady(true);
              setMessage((current) => (current === "Abriendo la página de OnlyFans…" ? "" : current));
            }
          }
          bitmap.close();
        } catch {
          // Un JPEG a medias no se pinta.
        }
        paint.busy = false;
        const next = paint.pending;
        paint.pending = null;
        if (next) void draw(next);
      },
    };
    const readyOnce = { current: false };

    const disconnect = () => {
      socket?.close();
      socket = null;
      socketRef.current = null;
    };

    const start = async () => {
      setReady(false);
      setNotice("");
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
        publishSize();
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
            if (payload.type === "notice") {
              setNotice(payload.reason?.trim() || "");
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
        if (!(event.data instanceof ArrayBuffer)) return;
        const buffer = event.data;
        if (paint.busy) {
          paint.pending = buffer;
          return;
        }
        void paint.draw(buffer);
      });
      socket.addEventListener("close", () => {
        if (cancelled) return;
        setReady(false);
        setMessage((current) => current || "La conexión con la vista nativa se ha cerrado.");
      });
    };

    const box = boxRef.current;
    const publishSize = () => {
      if (!box || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
      const width = Math.round(box.clientWidth);
      const height = Math.round(box.clientHeight);
      if (width < 240 || height < 180) return;
      socketRef.current.send(JSON.stringify({ type: "resize", width, height }));
    };
    const observer = box ? new ResizeObserver(() => publishSize()) : null;
    if (box && observer) observer.observe(box);
    void start().then(() => publishSize());
    return () => {
      cancelled = true;
      observer?.disconnect();
      disconnect();
    };
  }, [creatorId, section]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === boxRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const sendInput = (payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  };

  const point = (event: MouseEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    return containedCanvasPoint(
      event.nativeEvent.offsetX,
      event.nativeEvent.offsetY,
      { width: canvas.clientWidth, height: canvas.clientHeight },
      { width: canvas.width, height: canvas.height },
    );
  };

  const solving = notice.length > 0;
  const canType = solving || statusRef.current?.role !== "view";

  const toggleFull = () => {
    const node = boxRef.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void node.requestFullscreen();
  };

  if (!ready && message && message !== "Abriendo la página de OnlyFans…") {
    return <ComingSoonPage title="Operativa" hint={message} />;
  }

  return (
    <div ref={boxRef} className="relative flex min-h-0 flex-1 flex-col bg-[#0c100f]">
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        <button
          type="button"
          onClick={toggleFull}
          className="rounded-md bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
        >
          {full ? "Salir" : "Pantalla completa"}
        </button>
      </div>
      {notice ? (
        <p className="shrink-0 border-b border-amber-500/40 bg-amber-950/90 px-4 py-3 text-sm text-amber-100" role="alert">
          {notice}
        </p>
      ) : message ? (
        <p className="shrink-0 px-4 py-2 text-sm text-white/80">{message}</p>
      ) : null}
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Página de OnlyFans"
        className="min-h-0 w-full flex-1 cursor-default bg-black object-contain outline-none"
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
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          event.preventDefault();
          sendInput({ type: "key", key: event.key, code: event.code, down: true });
        }}
        onKeyUp={(event) => {
          if (!canType) return;
          if (event.metaKey || event.ctrlKey || event.altKey) return;
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
