import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { menuPlacement } from "@/lib/fixed-menu";

export function FixedMenu({
  open,
  onClose,
  anchor,
  children,
  className,
  label,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  children: ReactNode;
  className?: string;
  label?: string;
  testId?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = () => {
    const node = menuRef.current;
    if (!anchor || !node) return;
    const next = menuPlacement(
      anchor.getBoundingClientRect(),
      { width: node.offsetWidth, height: node.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos({ top: next.top, left: next.left });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      data-testid={testId ?? "fixed-menu"}
      data-menu-portal
      className={`fixed z-[80] rounded-md border border-line bg-surface p-1 text-sm text-fg shadow-[0_8px_28px_rgba(15,23,42,0.18)] ${className ?? "w-56"}`}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}
