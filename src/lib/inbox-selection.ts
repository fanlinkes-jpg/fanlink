import { useCallback, useEffect, useRef, useState } from "react";

/** La conversación tiene que seguir a la vista este tiempo antes de marcarla. */
export const MARK_SEEN_MS = 800;

export type InboxThread = {
  id: string;
  unread: number | null;
  lastMessageAt: string | null;
};

export function arrowIgnored(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const node = target as { tagName?: string; isContentEditable?: boolean; closest?: (selector: string) => unknown };
  const tag = node.tagName ?? "";
  if (tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable) return true;
  return typeof node.closest === "function" && node.closest("input, textarea, [contenteditable], [role='textbox']") != null;
}

function pageIsVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function unreadGrew(previous: number | null, next: number | null): boolean {
  if (next == null || next === 0) return false;
  if (previous == null) return true;
  return next > previous;
}

/**
 * La primera conversación se elige una vez. Un mensaje nuevo arriba no la cambia.
 * El hilo elegido sigue en la lista aunque la pastilla ya no lo incluya.
 * Marcar leído espera MARK_SEEN_MS con la pestaña visible, fuera del lector de la cuenta.
 */
export function useInboxSelection<T extends InboxThread>(input: {
  threads: readonly T[];
  matches: (thread: T) => boolean;
  hidden: (thread: T) => boolean;
  showHidden: boolean;
  onMark: (thread: T) => void;
  seenMs?: number;
}): {
  selected: T | null;
  visible: T[];
  choose: (thread: { id: string }) => void;
  onArrow: (event: { key: string; target: EventTarget | null; preventDefault: () => void }) => void;
} {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pinned = useRef(false);
  const marked = useRef<{ id: string; unread: number | null } | null>(null);
  const onMark = useRef(input.onMark);
  onMark.current = input.onMark;
  const seenMs = input.seenMs ?? MARK_SEEN_MS;
  const sorted = [...input.threads].sort((left, right) => (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? ""));
  const visible = sorted.filter((thread) => {
    const selected = thread.id === selectedId;
    if (!input.matches(thread) && !selected) return false;
    if (input.hidden(thread) && !input.showHidden && !selected) return false;
    return true;
  });
  const selected = input.threads.find((thread) => thread.id === selectedId) ?? null;
  const firstId = sorted.find((thread) => input.matches(thread) && (input.showHidden || !input.hidden(thread)))?.id ?? null;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (pinned.current || !firstId) return;
    pinned.current = true;
    setSelectedId(firstId);
  }, [firstId]);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    const current = selectedRef.current;
    if (!current || current.unread === 0) return;
    const seen = marked.current;
    if (seen && seen.id === current.id && !unreadGrew(seen.unread, current.unread)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!pageIsVisible()) return;
      timer = setTimeout(() => {
        timer = undefined;
        const latest = selectedRef.current;
        if (!latest || latest.id !== current.id || !pageIsVisible()) return;
        marked.current = { id: latest.id, unread: latest.unread };
        onMark.current(latest);
      }, seenMs);
    };
    arm();
    const onVisibility = () => arm();
    document.addEventListener?.("visibilitychange", onVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener?.("visibilitychange", onVisibility);
    };
  }, [selected?.id, selected?.unread, seenMs]);

  const choose = useCallback((thread: { id: string }) => {
    pinned.current = true;
    setSelectedId(thread.id);
  }, []);

  const onArrow = useCallback((event: { key: string; target: EventTarget | null; preventDefault: () => void }) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (arrowIgnored(event.target)) return;
    const rows = visibleRef.current;
    const index = rows.findIndex((thread) => thread.id === selectedId);
    const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    pinned.current = true;
    setSelectedId(next.id);
  }, [selectedId]);

  return { selected, visible, choose, onArrow };
}
