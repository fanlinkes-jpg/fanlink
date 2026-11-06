import { useEffect, useRef, useState } from "react";
import { openLiveView } from "@/lib/of-sessions";

type DeskMessage =
  | { type: "mouse"; action: "down" | "up" | "move"; x: number; y: number; canvasWidth: number; canvasHeight: number; button?: "left" | "right" | "middle" }
  | { type: "wheel"; x: number; y: number; canvasWidth: number; canvasHeight: number; deltaX: number; deltaY: number }
  | { type: "key"; key: string; code: string; down: boolean }
  | { type: "text"; text: string }
  | { type: "resize"; width: number; height: number }
  | { type: "file"; name: string; mime: string; data: string };

export function LiveOnlyFans({ creatorId, threadKey, fanKey }: { creatorId: string; threadKey: string; fanKey: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [note, setNote] = useState("Conectando…");
  const [control, setControl] = useState(false);

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    void openLiveView({ data: { creatorId, threadKey, fanKey } }).then((result) => {
      if (closed) return;
      if (!result.ok || !result.ticket) {
        setNote(result.reason ?? "Vista en directo desactivada");
        return;
      }
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/api/live-view?ticket=${encodeURIComponent(result.ticket)}`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          const status = JSON.parse(event.data) as { type?: string; role?: string };
          if (status.type === "file") fileRef.current?.click();
          if (status.role) {
            setControl(status.role === "control");
            setNote(status.role === "control" ? "Tienes el control" : "Solo lectura");
          }
          return;
        }
        const blob = new Blob([event.data], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.width = image.width;
          canvas.height = image.height;
          canvas.getContext("2d")?.drawImage(image, 0, 0);
          URL.revokeObjectURL(url);
        };
        image.src = url;
      };
      socket.onopen = () => {
        const canvas = canvasRef.current;
        const rect = canvas?.getBoundingClientRect();
        send({ type: "resize", width: rect?.width ?? 1100, height: rect?.height ?? 720 });
      };
      socket.onclose = () => {
        if (!closed) setNote("Vista cerrada");
      };
    }).catch(() => {
      if (!closed) setNote("Vista en directo desactivada");
    });
    return () => {
      closed = true;
      socket?.close();
      socketRef.current = null;
    };
  }, [creatorId, threadKey, fanKey]);

  function send(message: DeskMessage) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  function point(event: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
      canvasWidth: rect?.width ?? 1,
      canvasHeight: rect?.height ?? 1,
    };
  }

  return (
    <div className="relative min-h-0 flex-1 bg-[#111318]" tabIndex={0} onKeyDown={(event) => {
      if (!control) return;
      if (event.key === "Paste") return;
      event.preventDefault();
      send({ type: "key", key: event.key, code: event.code, down: true });
    }} onKeyUp={(event) => {
      if (!control || event.key.length === 1) return;
      send({ type: "key", key: event.key, code: event.code, down: false });
    }} onPaste={(event) => {
      if (!control) return;
      const text = event.clipboardData.getData("text");
      if (!text) return;
      event.preventDefault();
      send({ type: "text", text });
    }}>
      <p className="absolute left-3 top-3 z-10 rounded bg-black/60 px-2 py-1 text-xs text-white">{note}</p>
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        onMouseDown={(event) => control && send({ type: "mouse", action: "down", button: buttonOf(event.button), ...point(event) })}
        onMouseUp={(event) => control && send({ type: "mouse", action: "up", button: buttonOf(event.button), ...point(event) })}
        onMouseMove={(event) => control && send({ type: "mouse", action: "move", ...point(event) })}
        onWheel={(event) => {
          if (!control) return;
          event.preventDefault();
          send({ type: "wheel", deltaX: event.deltaX, deltaY: event.deltaY, ...point(event) });
        }}
      />
      <input ref={fileRef} type="file" className="hidden" aria-label="Archivo de OnlyFans" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || !control) {
          send({ type: "file", name: "", mime: "", data: "" });
          return;
        }
        void file.arrayBuffer().then((buffer) => {
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          send({ type: "file", name: file.name, mime: file.type, data: btoa(binary) });
        });
      }} />
    </div>
  );
}

function buttonOf(button: number): "left" | "right" | "middle" {
  if (button === 2) return "right";
  if (button === 1) return "middle";
  return "left";
}
