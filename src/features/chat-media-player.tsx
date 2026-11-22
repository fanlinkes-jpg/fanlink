import { useState } from "react";
import { chatMediaSrc } from "@/lib/chat-media";
import { SfwMedia } from "@/components/sfw-media";

export function ChatMediaPlayer({
  creatorId,
  threadKey,
  messageKey,
  index,
  kind,
  compact = false,
}: {
  creatorId: string;
  threadKey: string;
  messageKey: string;
  index: number;
  kind: "foto" | "video" | "audio" | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const preview = chatMediaSrc({ creatorId, threadKey, messageKey, index, variant: "preview" });
  const full = chatMediaSrc({ creatorId, threadKey, messageKey, index, variant: "full" });
  const thumb = kind === "foto" ? full : preview;
  if (kind === "audio") {
    return <audio controls preload="metadata" src={full} className={compact ? "h-full w-full" : "mb-1 w-full max-w-xs"} />;
  }
  const label = kind === "foto" ? "Ver foto" : "Reproducir";
  return (
    <div className={compact ? "h-full" : "mb-1"}>
      <button
        type="button"
        aria-label={label}
        className={`relative block w-full overflow-hidden rounded-lg bg-[#dfe3ea] ${compact ? "h-full" : "h-40 max-w-xs"}`}
        onClick={() => setOpen(true)}
      >
        {failed ? <span className="grid h-full place-items-center px-2 text-xs text-[#6d7585]">{label}</span> : (
          <SfwMedia className="block h-full w-full"><img src={thumb} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} /></SfwMedia>
        )}
        {kind === "video" && !failed ? <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[11px] text-white">Vídeo</span> : null}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-label="Reproducir">
          <button type="button" className="absolute right-4 top-4 rounded bg-white px-3 py-1 text-sm" onClick={() => setOpen(false)}>Cerrar</button>
          {kind === "foto" ? <SfwMedia><img src={full} alt="" className="max-h-[80vh] max-w-full object-contain" /></SfwMedia> : <SfwMedia><video controls autoPlay src={full} className="max-h-[80vh] max-w-full" /></SfwMedia>}
        </div>
      ) : null}
    </div>
  );
}