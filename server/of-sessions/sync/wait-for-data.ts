import { jsonUrlWithoutSecrets } from "../identity.ts";

/** La SPA pide el JSON de la sección después del shell. No se corta en networkidle. */
export const SECTION_WAIT_MS = 25_000;

/** Tras el gráfico, los movimientos pueden salir en otra respuesta. */
export const TRANSACTIONS_GRACE_MS = 8_000;

export function sectionWaitMs(siteId: string, configuredMs: number): number {
  if (siteId === "onlyfans") return Math.max(configuredMs, SECTION_WAIT_MS);
  return Math.max(0, configuredMs);
}

/**
 * OnlyFans ha movido la lista de fans. Se abre primero la ruta nueva y,
 * si no llega un JSON de suscriptores, la ruta anterior. No se llama al API.
 */
export function fanPageUrls(siteId: string, subscribersUrl: string | undefined): string[] {
  if (!subscribersUrl) return [];
  if (siteId !== "onlyfans") return [subscribersUrl];
  const modern = "https://onlyfans.com/my/collections/subscribers/active";
  if (modern === subscribersUrl) return [subscribersUrl];
  return [subscribersUrl, modern];
}

export function logApiResponse(channel: "lectura" | "chat", url: string, status: number): void {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return;
  }
  if (!path.includes("/api2/")) return;
  const safe = jsonUrlWithoutSecrets(url);
  if (!safe) return;
  console.info(`[fanlink:${channel}] api2 status=${status} ${safe}`);
}

export function logSection(
  channel: "lectura" | "chat",
  section: string,
  pageUrl: string,
  dataUrl: string | null,
  records: number,
  extra = "",
): void {
  const page = jsonUrlWithoutSecrets(pageUrl) ?? "ninguna";
  const data = dataUrl ? (jsonUrlWithoutSecrets(dataUrl) ?? dataUrl) : "ninguna";
  console.info(`[fanlink:${channel}] ${section} pagina=${page} url=${data} registros=${records}${extra}`);
}

/**
 * Espera, con scroll, a que `ready` sea cierto o se agote el presupuesto.
 * El primer drenado recoge respuestas que ya llegaron al cargar.
 */
export async function settleUntil(input: {
  budgetMs: number;
  paceMs: number;
  ready: () => boolean;
  scroll: boolean;
  wheel: (dy: number) => Promise<void>;
  pause: (ms: number) => Promise<void>;
  drain: () => Promise<void>;
}): Promise<void> {
  const start = Date.now();
  let step = 0;
  await input.drain();
  while (Date.now() - start < input.budgetMs && !input.ready()) {
    if (input.scroll) await input.wheel(620 + (step % 4) * 160);
    const left = input.budgetMs - (Date.now() - start);
    if (left <= 0) break;
    await input.pause(Math.min(Math.max(input.paceMs, 200), left));
    await input.drain();
    step += 1;
    if (step >= 40) break;
  }
  await input.drain();
}
