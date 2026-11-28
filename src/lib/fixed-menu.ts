/** Coloca un menú fijo junto al disparador: hacia arriba si no cabe abajo, sin salir del viewport. */
export function menuPlacement(
  anchor: { top: number; bottom: number; left: number; right: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 4,
  pad = 8,
): { top: number; left: number; openUp: boolean } {
  const spaceBelow = viewport.height - anchor.bottom - pad;
  const spaceAbove = anchor.top - pad;
  const openUp = menu.height > spaceBelow && spaceAbove > spaceBelow;
  const rawTop = openUp ? anchor.top - menu.height - gap : anchor.bottom + gap;
  const maxTop = Math.max(pad, viewport.height - menu.height - pad);
  const top = Math.min(Math.max(pad, rawTop), maxTop);
  const rawLeft = anchor.right - menu.width;
  const maxLeft = Math.max(pad, viewport.width - menu.width - pad);
  const left = Math.min(Math.max(pad, rawLeft), maxLeft);
  return { top, left, openUp };
}
