import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type RefObject, type KeyboardEvent, type PointerEvent, type TouchEvent, type WheelEvent } from "react";
import { anchorShift, keyScrollsUp, stickAfterScroll, userRecently, type ScrollSample } from "@/lib/stick-bottom";

type Anchor = { key: string; offset: number };

function sampleOf(node: HTMLElement): ScrollSample {
  return { top: node.scrollTop, height: node.scrollHeight, client: node.clientHeight };
}

/** Primer mensaje que se ve en la lista y dónde está respecto al scroll. */
function measureAnchor(node: HTMLElement): Anchor | null {
  for (const child of Array.from(node.children)) {
    const el = child as HTMLElement;
    const key = el.dataset.messageId;
    if (!key) continue;
    if (el.offsetTop + el.offsetHeight > node.scrollTop) return { key, offset: el.offsetTop - node.scrollTop };
  }
  return null;
}

function anchorOffsetNow(node: HTMLElement, anchor: Anchor): number | null {
  for (const child of Array.from(node.children)) {
    const el = child as HTMLElement;
    if (el.dataset.messageId === anchor.key) return el.offsetTop - node.scrollTop;
  }
  return null;
}

/**
 * Mantiene una lista de mensajes en el último mensaje, sin pelear con la persona.
 * - Al abrir otro chat se pega al final y vuelve a pegarse mientras llegan mensajes, historial y medios.
 * - Un ResizeObserver mira la lista y cada mensaje: si cambia el alto, baja otra vez mientras siga pegado.
 * - Cualquier gesto hacia arriba (rueda, dedo, teclas, barra de scroll, incluso el primer píxel) suelta el final
 *   al instante y cancela todos los reintentos pendientes. Solo se vuelve a pegar si la persona baja
 *   por sí misma hasta menos de 30 px del final.
 * - Si no está pegado y entra contenido por arriba (historial antiguo), el scroll se corrige para que
 *   lo que se lee no se mueva.
 * El scroll de bajar es instantáneo, aunque la página tenga `scroll-behavior: smooth`.
 */
export function useStickToBottom(input: {
  box: RefObject<HTMLElement | null>;
  stick: MutableRefObject<boolean>;
  threadKey: string | null;
  /** Cambia cuando llega o sale un mensaje. */
  tail: string;
}) {
  const latest = useRef(input);
  latest.current = input;
  const lastUser = useRef(0);
  const pointerHeld = useRef(false);
  const touchY = useRef<number | null>(null);
  const prev = useRef<ScrollSample>({ top: 0, height: 0, client: 0 });
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const frames = useRef<number[]>([]);

  // Antes de pintar el cambio, se apunta qué mensaje se está leyendo (solo si la persona no está abajo).
  const reading = useRef<Anchor | null>(null);
  const node0 = input.box.current;
  reading.current = node0 && !input.stick.current ? measureAnchor(node0) : null;

  function cancelPending() {
    for (const timer of timers.current) clearTimeout(timer);
    for (const frame of frames.current) cancelAnimationFrame(frame);
    timers.current = [];
    frames.current = [];
  }

  function release() {
    latest.current.stick.current = false;
    cancelPending();
  }

  function follow() {
    const { box, stick } = latest.current;
    const node = box.current;
    if (!node || !stick.current) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight > 0.5) node.scrollTo({ top: node.scrollHeight, behavior: "instant" });
    prev.current = sampleOf(node);
  }

  function later(run: () => void, ms: number) {
    timers.current.push(setTimeout(run, ms));
  }

  function frame(run: () => void) {
    frames.current.push(requestAnimationFrame(run));
  }

  // Cada cambio de contenido: si entró algo por arriba y se está leyendo, el mensaje se queda donde estaba.
  useLayoutEffect(() => {
    const node = latest.current.box.current;
    const anchor = reading.current;
    if (node && anchor && !latest.current.stick.current) {
      const shift = anchorShift(anchor, anchorOffsetNow(node, anchor));
      if (shift !== 0) node.scrollTop += shift;
      prev.current = sampleOf(node);
    }
  });

  useLayoutEffect(() => {
    latest.current.stick.current = true;
    cancelPending();
    follow();
    frame(() => frame(follow));
    for (const ms of [120, 400, 1000, 2500]) later(follow, ms);
    return cancelPending;
  }, [input.threadKey]);

  useLayoutEffect(() => {
    follow();
    frame(follow);
  }, [input.tail]);

  useEffect(() => {
    const node = input.box.current;
    if (!node) return;
    const watched = new Set<Element>();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => follow());
    const watch = () => {
      if (!resize) return;
      for (const child of Array.from(node.children)) {
        if (watched.has(child)) continue;
        watched.add(child);
        resize.observe(child);
      }
    };
    resize?.observe(node);
    watch();
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => { watch(); follow(); });
    mutations?.observe(node, { childList: true });
    const onWindow = () => follow();
    const onPointerEnd = () => { pointerHeld.current = false; };
    window.addEventListener("resize", onWindow);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    prev.current = sampleOf(node);
    return () => {
      resize?.disconnect();
      mutations?.disconnect();
      window.removeEventListener("resize", onWindow);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [input.threadKey]);

  const markUser = () => { lastUser.current = Date.now(); };
  return {
    /** Baja al final si sigue pegada. Para cuando carga una imagen o un vídeo. */
    follow,
    /** Llamar desde el onScroll de la lista. Devuelve si sigue pegada al final. */
    noteScroll(node: HTMLElement): boolean {
      const now = sampleOf(node);
      const stuck = stickAfterScroll({
        now,
        prev: prev.current,
        wasStuck: latest.current.stick.current,
        userActive: pointerHeld.current || userRecently(lastUser.current, Date.now()),
      });
      prev.current = now;
      if (!stuck && latest.current.stick.current) cancelPending();
      latest.current.stick.current = stuck;
      if (stuck) follow();
      return stuck;
    },
    /** Propiedades de la lista: lo que cuenta como gesto de la persona. */
    intent: {
      onWheel: (event: WheelEvent<HTMLElement>) => {
        markUser();
        if (event.deltaY < 0) release();
      },
      onTouchStart: (event: TouchEvent<HTMLElement>) => {
        markUser();
        touchY.current = event.touches[0]?.clientY ?? null;
      },
      onTouchMove: (event: TouchEvent<HTMLElement>) => {
        markUser();
        const y = event.touches[0]?.clientY;
        if (y != null && touchY.current != null && y > touchY.current) release();
        touchY.current = y ?? touchY.current;
      },
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        markUser();
        pointerHeld.current = true;
        const el = event.currentTarget;
        // Pulsar en la barra de scroll: se suelta el final de inmediato.
        if (event.target === el && event.nativeEvent.offsetX >= el.clientWidth) release();
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        markUser();
        if (keyScrollsUp(event)) release();
      },
    },
  };
}
