import { useMemo, useState } from "react";
import { Lock, X } from "lucide-react";
import { filterGallery, galleryCounts, galleryItems, type GalleryFilter, type GalleryMessage } from "@/lib/chat-gallery";
import { clipLabel } from "@/lib/ppv-timeline";

const KINDS: Array<{ id: GalleryFilter["kind"]; label: string }> = [
  { id: "todos", label: "Todo" },
  { id: "foto", label: "Fotos" },
  { id: "video", label: "Vídeos" },
];
const PAY: Array<{ id: GalleryFilter["pay"]; label: string }> = [
  { id: "todos", label: "Pagado y gratis" },
  { id: "pagado", label: "Pagado" },
  { id: "gratis", label: "Gratis" },
];

/** Galería de la conversación: todos los medios guardados de este chat, con filtros. */
export function ChatGalleryPanel({
  messages,
  onClose,
  onJump,
}: {
  messages: readonly GalleryMessage[];
  onClose: () => void;
  onJump: (messageKey: string) => void;
}) {
  const [filter, setFilter] = useState<GalleryFilter>({ kind: "todos", pay: "todos" });
  const all = useMemo(() => galleryItems(messages), [messages]);
  const counts = useMemo(() => galleryCounts(all), [all]);
  const shown = useMemo(() => filterGallery(all, filter), [all, filter]);
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Cerrar galería" onClick={onClose} />
      <div role="dialog" aria-label="Galería" className="absolute inset-y-6 left-1/2 flex w-[min(96vw,820px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#e6e8ee] px-5 py-3">
          <div>
            <p className="text-base font-semibold">Galería</p>
            <p className="text-xs text-[#6d7585]">{counts.total} medios · {counts.fotos} fotos · {counts.videos} vídeos · {counts.pagados} de pago · {counts.gratis} gratis</p>
          </div>
          <button type="button" aria-label="Cerrar" className="rounded-full p-1.5 hover:bg-[#f4f7ff]" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-[#e6e8ee] px-5 py-2 text-xs">
          {KINDS.map((item) => (
            <button key={item.id} type="button" aria-pressed={filter.kind === item.id} className={`rounded-full border px-3 py-1 ${filter.kind === item.id ? "border-[#2456c7] bg-[#eef2ff] text-[#2456c7]" : "border-[#e6e8ee]"}`} onClick={() => setFilter({ ...filter, kind: item.id })}>{item.label}</button>
          ))}
          <span className="mx-1 w-px bg-[#e6e8ee]" />
          {PAY.map((item) => (
            <button key={item.id} type="button" aria-pressed={filter.pay === item.id} className={`rounded-full border px-3 py-1 ${filter.pay === item.id ? "border-[#2456c7] bg-[#eef2ff] text-[#2456c7]" : "border-[#e6e8ee]"}`} onClick={() => setFilter({ ...filter, pay: item.id })}>{item.label}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-[#6d7585]">{all.length === 0 ? "Sin medios guardados en esta conversación." : "Ningún medio con estos filtros."}</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {shown.map((item) => (
                <li key={item.id}>
                  <button type="button" className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl bg-[#d7dee8]" aria-label="Ir al mensaje" onClick={() => onJump(item.messageKey)}>
                    {item.preview ? <img src={item.preview} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                    {item.paid ? <span className="absolute left-1 top-1 rounded-full bg-[#ff5a7a] px-1.5 py-0.5 text-[10px] font-semibold text-white">Pago</span> : null}
                    {item.locked ? <Lock className="absolute right-1 top-1 h-4 w-4 text-white drop-shadow" aria-label="Con candado" /> : null}
                    {clipLabel(item.seconds) ? <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{clipLabel(item.seconds)}</span> : null}
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">{item.sentAt.slice(5, 10).replace("-", "/")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
