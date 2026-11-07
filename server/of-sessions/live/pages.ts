import type { BrowserContext, Page } from "playwright";

const livePages = new WeakSet<Page>();

export function markLivePage(page: Page): void {
  livePages.add(page);
}

export function isLivePage(page: Page): boolean {
  return livePages.has(page);
}

export function contextShowsInbox(context: BrowserContext): boolean {
  return context.pages().some((page) => {
    if (isLivePage(page)) return true;
    try {
      return page.url().includes("/my/chats");
    } catch {
      return false;
    }
  });
}

/** El lector no cierra la pestaña que el operador está viendo. */
export async function closeIfIdle(page: Page): Promise<void> {
  if (isLivePage(page)) return;
  let url = "";
  try {
    url = page.url();
  } catch {
    return;
  }
  if (url.includes("/my/chats")) return;
  await page.close().catch(() => undefined);
}
