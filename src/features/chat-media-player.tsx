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
  const [failed, setFailed] = useState(false);
  const preview = chatMediaSrc({ creatorId, threadKey, messageKey, index, variant: "preview" });
  const full = chatMediaSrc({ creatorId, threadKey, messageKey, index, variant: "full" });
  const thumb = kind === "foto" ? full : preview;
  if (kind === "audio") {
    return <audio controls preload="metadata" src={full} className="mb-1 w-full max-w-xs" />;
  }
  const label = kind === "foto" ? "Ver foto" : "Reproducir";
  return (
    <div className="mb-1">
      <button
        type="button"
        aria-label={label}
        className="relative block h-40 w-full max-w-xs overflow-hidden rounded-lg bg-[#dfe3ea]"
        onClick={() => setOpen(true)}
      >
        {failed ? <span className="grid h-full place-items-center px-2 text-xs text-[#6d7585]">{label}</span> : (
          <img src={thumb} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
        )}
        {kind === "video" && !failed ? <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[11px] text-white">Vídeo</span> : null}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-label="Reproducir">
          <button type="button" className="absolute right-4 top-4 rounded bg-white px-3 py-1 text-sm" onClick={() => setOpen(false)}>Cerrar</button>
          {kind === "foto" ? <img src={full} alt="" className="max-h-[80vh] max-w-full object-contain" /> : <video controls autoPlay src={full} className="max-h-[80vh] max-w-full" />}
        </div>
      ) : null}
    </div>
  );
}