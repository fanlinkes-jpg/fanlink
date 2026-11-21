/** Traduce el clic del canvas con object-fit: contain al bitmap, sin las bandas negras. */
export function containedCanvasPoint(
  offsetX: number,
  offsetY: number,
  box: { width: number; height: number },
  bitmap: { width: number; height: number },
): { x: number; y: number; canvasWidth: number; canvasHeight: number } {
  const bitmapW = Math.max(1, bitmap.width);
  const bitmapH = Math.max(1, bitmap.height);
  const boxW = Math.max(1, box.width);
  const boxH = Math.max(1, box.height);
  const scale = Math.min(boxW / bitmapW, boxH / bitmapH);
  const padX = (boxW - bitmapW * scale) / 2;
  const padY = (boxH - bitmapH * scale) / 2;
  return {
    x: (offsetX - padX) / scale,
    y: (offsetY - padY) / scale,
    canvasWidth: bitmapW,
    canvasHeight: bitmapH,
  };
}
