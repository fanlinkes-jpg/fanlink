import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { stickAfterScroll, userRecently } from "@/lib/stick-bottom";

/**
 * Mantiene una lista de mensajes en el último mensaje.
 * - Al abrir otro chat se pega al final y vuelve a pegarse mientras llegan mensajes, historial y medios.
 * - Un ResizeObserver mira la lista y cada mensaje: si cambia el alto de cualquiera, o el de la propia lista
 *   (un aviso aparece encima, el compositor crece), baja otra vez mientras la persona no haya subido.
 * - Solo la persona suelta el final (rueda, dedo, teclado, barra de scroll). Un scroll del navegador no.
 * El scroll de abrir es instantáneo, aunque la página tenga `scroll-behavior: smooth`.
 */
export function useStickToBottom(input: {
  box: RefObject<HTMLElement | null>;
  stick: MutableRefObject<boolean>;
  threadKey: string | null;
  /** Cambia cuando llega o sale un mensaje. */
  tail: string;
  /** Verdadero mientras otra lógica (cargar historial antiguo) conserva la posición. */
  blocked: () => boolean;
}) {
  const latest = useRef(input);
  latest.current = input;
  const lastUser = useRef(0);

  function follow() {
    const { box, stick, blocked } = latest.current;
    const node = box.current;
    if (!node || !stick.current || blocked()) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight > 0.5) node.scrollTo({ top: node.scrollHeight, behavior: "instant" });
  }

  useLayoutEffect(() => {
    latest.current.stick.current = true;
    follow();
    const frame = requestAnimationFrame(() => requestAnimationFrame(follow));
    const timers = [120, 400, 1000, 2500].map((ms) => setTimeout(follow, ms));
    return () => {
      cancelAnimationFrame(frame);
      for (const timer of timers) clearTimeout(timer);
    };
  }, [input.threadKey]);

  useLayoutEffect(() => {
    follow();
    const frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
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
    window.addEventListener("resize", onWindow);
    return () => {
      resize?.disconnect();
      mutations?.disconnect();
      window.removeEventListener("resize", onWindow);
    };
  }, [input.threadKey]);

  const markUser = () => { lastUser.current = Date.now(); };
  return {
    /** Baja al final si sigue pegada. Para cuando carga una imagen o un vídeo. */
    follow,
    /** Llamar desde el onScroll de la lista. Devuelve si sigue pegada al final. */
    noteScroll(node: HTMLElement): boolean {
      const stuck = stickAfterScroll({
        distance: node.scrollHeight - node.scrollTop - node.clientHeight,
        userRecently: userRecently(lastUser.current, Date.now()),
        wasStuck: latest.current.stick.current,
      });
      latest.current.stick.current = stuck;
      if (stuck) follow();
      return stuck;
    },
    /** Propiedades de la lista: lo que cuenta como intención de la persona. */
    intent: {
      onWheel: markUser,
      onTouchStart: markUser,
      onTouchMove: markUser,
      onPointerDown: markUser,
      onKeyDown: markUser,
    },
  };
}
