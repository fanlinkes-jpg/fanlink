type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/**
 * CDP para minimizar. No se usa en la vista: en Chromium 156 el screencast
 * deja de emitir frames con windowState=minimized (0 frames tras minimizar,
 * y sigue con la ventana normal).
 */
export async function minimizeLiveWindow(send: CdpSend): Promise<boolean> {
  try {
    const got = await send("Browser.getWindowForTarget");
    const windowId = windowIdOf(got);
    if (windowId == null) return false;
    await send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
    return true;
  } catch {
    return false;
  }
}

function windowIdOf(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("windowId" in value)) return null;
  const id = value.windowId;
  return typeof id === "number" && Number.isInteger(id) ? id : null;
}
