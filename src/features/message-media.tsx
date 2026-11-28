import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Lock, Play, Tag, Video } from "lucide-react";
import { chatMediaSrc } from "@/lib/chat-media";
import { clipLabel } from "@/lib/ppv-timeline";
import { SfwMedia } from "@/components/sfw-media";

export type MessageSlide = {
  index: number;
  kind: "foto" | "video" | "audio" | null;
  locked: boolean;
  seconds: number | null;
};

type Ids = { creatorId: string; threadKey: string; messageKey: string };

/** Un medio dentro de la burbuja: miniatura real, play centrado o candado sobre la miniatura. */
function Slide({ ids, slide }: { ids: Ids; slide: MessageSlide }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"preview" | "full" | "failed">("preview");
  const preview = chatMediaSrc({ ...ids, index: slide.index, variant: "preview" });
  const full = chatMediaSrc({ ...ids, index: slide.index, variant: "full" });
  if (slide.kind === "audio" && !slide.locked) {
    return <div className="grid h-full place-items-center bg-[#eef2fb] px-4"><audio controls preload="metadata" src={full} className="w-full" /></div>;
  }
  const thumb = stage === "failed" ? null : (
    <SfwMedia className="block h-full w-full">
      <img
        src={stage === "preview" ? preview : full}
        alt=""
        loading="lazy"
        draggable={false}
        className={`h-full w-full object-cover ${slide.locked ? "scale-110 blur-lg" : ""}`}
        onError={() => setStage((current) => (current === "preview" ? "full" : "failed"))}
      />
    </SfwMedia>
  );
  return (
    <div className="relative h-full w-full bg-gradient-to-br from-[#cfd6e2] to-[#aab4c6]">
      {thumb}
      {slide.locked ? (
        <span className="absolute inset-0 grid place-items-center bg-black/25" aria-label="Medio bloqueado">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white"><Lock className="h-5 w-5" aria-hidden /></span>
        </span>
      ) : (
        <button
          type="button"
          aria-label={slide.kind === "foto" ? "Ver foto" : "Reproducir"}
          className="absolute inset-0 grid place-items-center"
          onClick={() => setOpen(true)}
        >
          {slide.kind === "video" ? (
            <span className="grid h-14 w-14 place-items-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm"><Play className="ml-0.5 h-6 w-6" fill="currentColor" aria-hidden /></span>
          ) : null}
        </button>
      )}
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-label="Reproducir">
          <button type="button" className="absolute right-4 top-4 rounded bg-white px-3 py-1 text-sm" onClick={() => setOpen(false)}>Cerrar</button>
          {slide.kind === "foto" ? <SfwMedia><img src={full} alt="" className="max-h-[80vh] max-w-full object-contain" /></SfwMedia> : <SfwMedia><video controls autoPlay src={full} className="max-h-[80vh] max-w-full" /></SfwMedia>}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Medio a ancho completo de la burbuja, con esquinas redondeadas de la propia burbuja.
 * Varios medios van en carrusel con flechas, swipe y contador. Marca de agua y etiqueta de precio como en OnlyFans.
 */
export function MessageMedia({
  ids,
  slides,
  watermark,
  tagged,
  priceLabel,
}: {
  ids: Ids;
  slides: MessageSlide[];
  watermark: string | null;
  tagged: boolean;
  priceLabel: string | null;
}) {
  const [index, setIndex] = useState(0);
  const start = useRef<number | null>(null);
  const count = slides.length;
  const current = Math.min(index, Math.max(0, count - 1));
  const slide = slides[current];
  if (!slide) return null;
  const go = (next: number) => setIndex(Math.min(count - 1, Math.max(0, next)));
  const duration = clipLabel(slide.seconds);
  const KindIcon = slide.kind === "video" ? Video : ImageIcon;
  return (
    <div
      className="group relative aspect-[4/5] max-h-[440px] w-full overflow-hidden bg-[#dfe3ea]"
      role="region"
      aria-label="Medios del mensaje"
      onPointerDown={(event) => { start.current = event.clientX; }}
      onPointerUp={(event) => {
        if (start.current == null) return;
        const delta = event.clientX - start.current;
        start.current = null;
        if (delta > 40) go(current - 1);
        if (delta < -40) go(current + 1);
      }}
    >
      <Slide key={`${ids.messageKey}-${slide.index}`} ids={ids} slide={slide} />
      {tagged || priceLabel ? (
        <span className="pointer-events-none absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm" title={priceLabel ?? "Etiquetas"}><Tag className="h-3.5 w-3.5" aria-hidden /></span>
      ) : null}
      {watermark ? <span className="pointer-events-none absolute bottom-2.5 left-3 text-[11px] font-medium tracking-wide text-white/80 [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">OnlyFans.com/{watermark.replace(/^@/, "")}</span> : null}
      {count > 1 || duration ? (
        <span className="pointer-events-none absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          <KindIcon className="h-3 w-3" aria-hidden />
          {count > 1 ? `${current + 1}/${count}` : duration}
        </span>
      ) : null}
      {current > 0 ? (
        <button type="button" aria-label="Medio anterior" className="absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/60" onClick={() => go(current - 1)}><ChevronLeft className="h-4 w-4" aria-hidden /></button>
      ) : null}
      {current < count - 1 ? (
        <button type="button" aria-label="Medio siguiente" className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/60" onClick={() => go(current + 1)}><ChevronRight className="h-4 w-4" aria-hidden /></button>
      ) : null}
    </div>
  );
}
