import type { Page } from "playwright";

export type FanMenuRequest =
  | { action: "lists" }
  | { action: "list"; name: string }
  | { action: "discount"; percent: number }
  | { action: "restrict" }
  | { action: "block" }
  | { action: "report"; reason: string };

export type FanMenuResult = {
  ok: boolean;
  reason: string | null;
  lists: Array<{ name: string; on: boolean }>;
};

const LABELS: Record<FanMenuRequest["action"], RegExp> = {
  lists: /listas|lists/i,
  list: /listas|lists/i,
  discount: /descuento|discount/i,
  restrict: /^restringir$|^restrict$/i,
  block: /^bloquear$|^block$/i,
  report: /^denunciar$|^report$/i,
};

const SKIP = /listas|lists|descuento|discount|restringir|restrict|bloquear|block|denunciar|report|ocultar|hide|silenciar|mute|renombrar|rename|copiar|copy|enlace|link/i;

export function normalizeFanMenuRequest(value: unknown): FanMenuRequest | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.action === "lists") return { action: "lists" };
  if (row.action === "list" && typeof row.name === "string" && row.name.trim()) {
    return { action: "list", name: row.name.trim().slice(0, 80) };
  }
  if (row.action === "discount") {
    const percent = Number(row.percent);
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) return null;
    return { action: "discount", percent };
  }
  if (row.action === "restrict" || row.action === "block") return { action: row.action };
  if (row.action === "report" && typeof row.reason === "string" && row.reason.trim()) {
    return { action: "report", reason: row.reason.trim().slice(0, 200) };
  }
  return null;
}

/** Abre el menú real del chat y pulsa una acción. No dice que salió bien si el botón no está. */
export async function runFanMenuOnPage(page: Page, chatUrl: string, request: FanMenuRequest): Promise<FanMenuResult> {
  const empty = { ok: false, reason: "No se ha podido abrir el chat.", lists: [] as FanMenuResult["lists"] };
  await page.goto(chatUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  if (!(await openChatMenu(page))) return { ...empty, reason: "No se ha encontrado el menú de OnlyFans." };
  if (request.action === "lists" || request.action === "list") {
    if (!(await clickLabel(page, LABELS.lists))) return { ...empty, reason: "OnlyFans no muestra las listas." };
    const lists = await readLists(page);
    if (request.action === "lists") return { ok: lists.length > 0, reason: lists.length > 0 ? null : "Sin listas.", lists };
    const row = lists.find((item) => item.name === request.name);
    if (!row) return { ok: false, reason: "Esa lista no está.", lists };
    if (!(await clickLabel(page, new RegExp(`^${escapeRegExp(request.name)}$`)))) return { ok: false, reason: "No se ha podido cambiar la lista.", lists };
    return { ok: true, reason: null, lists: lists.map((item) => item.name === request.name ? { ...item, on: !item.on } : item) };
  }
  if (!(await clickLabel(page, LABELS[request.action]))) return { ...empty, reason: "OnlyFans no muestra esa acción." };
  if (request.action === "discount") {
    const input = page.getByRole("spinbutton").or(page.locator("input[type='number'], input[inputmode='numeric'], input[type='text']")).first();
    if (!(await input.isVisible().catch(() => false))) return { ...empty, reason: "OnlyFans no ha abierto el descuento." };
    await input.fill(String(request.percent));
    if (!(await clickLabel(page, /guardar|save|aplicar|apply/i))) return { ...empty, reason: "OnlyFans no ha guardado el descuento." };
    return { ok: true, reason: null, lists: [] };
  }
  if (request.action === "report") {
    const box = page.getByRole("textbox").first();
    if (await box.isVisible().catch(() => false)) await box.fill(request.reason);
  }
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) {
    const confirm = dialog.getByRole("button", { name: LABELS[request.action] }).or(dialog.getByRole("button", { name: /confirmar|confirm|enviar|send/i })).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
  }
  return { ok: true, reason: null, lists: [] };
}

async function openChatMenu(page: Page): Promise<boolean> {
  const named = page.getByRole("button", { name: /^(Más|More)$/i }).first();
  if (await named.isVisible().catch(() => false)) {
    await named.click();
    return true;
  }
  const extra = page.locator("button[aria-haspopup='menu'], button[class*='more' i]").first();
  if (await extra.isVisible().catch(() => false)) {
    await extra.click();
    return true;
  }
  const button = page.locator(".b-chat__header button, header button").last();
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    return true;
  }
  return false;
}

async function clickLabel(page: Page, pattern: RegExp): Promise<boolean> {
  const role = page.getByRole("button", { name: pattern }).or(page.getByRole("menuitem", { name: pattern })).or(page.getByRole("menuitemcheckbox", { name: pattern })).first();
  if (await role.isVisible().catch(() => false)) {
    await role.click();
    return true;
  }
  const text = page.getByText(pattern).first();
  if (!(await text.isVisible().catch(() => false))) return false;
  await text.click();
  return true;
}

async function readLists(page: Page): Promise<Array<{ name: string; on: boolean }>> {
  const rows = page.locator("[role=menuitemcheckbox], [role=menuitem]");
  const count = await rows.count();
  const lists: Array<{ name: string; on: boolean }> = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const name = (await row.innerText()).replace(/\s+/g, " ").trim();
    if (!name || SKIP.test(name)) continue;
    const pressed = await row.getAttribute("aria-pressed");
    const checked = await row.getAttribute("aria-checked");
    lists.push({ name: name.slice(0, 80), on: pressed === "true" || checked === "true" });
  }
  return lists;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
