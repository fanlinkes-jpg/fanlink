import { useState } from "react";
import { chatMediaSrc } from "@/lib/chat-media";

export function ChatMediaPlayer({
  creatorId,
  threadKey,
  messageKey,
  index,
  kind,
}: {
  creatorId: string;
  threadKey: string;
  messageKey: string;
  index: number;
  kind: "foto" | "video" | "audio" | null;
}) {
  const [open, setOpen] = useState(false);
  const src = chatMediaSrc({ creatorId, threadKey, messageKey, index });
  const label = kind === "audio" ? "Reproducir audio" : kind === "foto" ? "Ver foto" : "Reproducir";
  return (
    <div className="mb-1">
      <button type="button" aria-label={label} className="block w-full rounded bg-[#eceef2] px-2 py-3 text-center text-xs text-[#6d7585]" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-label="Reproducir">
          <button type="button" className="absolute right-4 top-4 rounded bg-white px-3 py-1 text-sm" onClick={() => setOpen(false)}>Cerrar</button>
          {kind === "audio" ? <audio controls preload="none" src={src} className="w-full max-w-md" /> : null}
          {kind === "foto" ? <img src={src} alt="" className="max-h-[80vh] max-w-full object-contain" /> : null}
          {kind !== "audio" && kind !== "foto" ? <video controls preload="none" src={src} className="max-h-[80vh] max-w-full" /> : null}
        </div>
      ) : null}
    </div>
  );
}
