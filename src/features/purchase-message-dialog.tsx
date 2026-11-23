import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Play, ShoppingBag, X } from "lucide-react";
import { chatMediaSrc } from "@/lib/chat-media";
import { readPurchaseMessage, type PurchaseMessageCard } from "@/lib/of-notifications";
import { purchaseDetailModel } from "@/lib/purchase-detail";

export function PurchaseMessageDialog({
  creatorId,
  creatorName,
  fanKey,
  threadKey,
  messageRef,
  onClose,
  onCompose,
}: {
  creatorId: string;
  creatorName: string;
  fanKey: string | null;
  threadKey: string | null;
  messageRef: string;
  onClose: () => void;
  onCompose: (mode: "quick" | "reply") => void;
}) {
  const [card, setCard] = useState<PurchaseMessageCard | null>(null);
  const [failed, setFailed] = useState(false);
  const model = purchaseDetailModel({ creatorName, priceCents: card?.priceCents ?? null });

  useEffect(() => {
    let stop = false;
    void readPurchaseMessage({ data: { creatorId, messageRef, fanKey } }).then((result) => {
      if (stop) return;
      setCard(result);
    }).catch(() => {
      if (!stop) setFailed(true);
    });
    return () => {
      stop = true;
    };
  }, [creatorId, fanKey, messageRef]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  const media = card?.media ?? [];
  const messageId = card?.messageId;
  const thread = card?.threadKey ?? threadKey ?? "";

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Message details"
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-[#1f9d55]" aria-hidden />
          <h2 className="text-base font-semibold text-[#1c2333]">{model.title}</h2>
          <button type="button" aria-label="Cerrar" className="ml-auto grid h-8 w-8 place-items-center rounded-full text-[#6d7585]" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-[#1c2333]">{failed ? "Sin datos" : card?.body || "Sin datos"}</p>
        {media.length > 0 && messageId ? (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {media.map((item, index) => (
              <figure key={`${messageId}-${index}`} className="relative h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-[#d7dee8]">
                <img alt="" src={chatMediaSrc({ creatorId, threadKey: thread, messageKey: messageId, index, variant: "preview" })} className="h-full w-full object-cover" />
                <Play className="absolute left-1 top-1 h-3.5 w-3.5 text-white" aria-hidden />
                {item.seconds != null ? <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{formatClip(item.seconds)}</span> : null}
              </figure>
            ))}
          </div>
        ) : null}
        <p className="mt-3 text-sm font-semibold text-[#1f9d55]">{model.price} · pagado</p>
        <p className="mt-1 text-xs text-[#6d7585]">{model.tags}</p>
        {card?.retryAfterMs ? <p className="mt-2 text-xs text-[#8a5a12]">OnlyFans pide esperar.</p> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="rounded-lg px-3 py-2 text-sm" onClick={onClose}>Cerrar</button>
          <button type="button" className="rounded-lg border border-[#e6e8ee] px-3 py-2 text-sm" onClick={() => onCompose("quick")}>Respuesta rápida</button>
          <button type="button" className="rounded-lg bg-[#3b6cff] px-3 py-2 text-sm text-white" onClick={() => onCompose("reply")}>Responder</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function formatClip(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
