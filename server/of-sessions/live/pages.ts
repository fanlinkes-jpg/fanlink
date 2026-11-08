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

/** Cierra la pestaña de trabajo. El chatter no se queda con la conversación de OnlyFans abierta. */
export async function closeIfIdle(page: Page): Promise<void> {
  await page.close().catch(() => undefined);
}
