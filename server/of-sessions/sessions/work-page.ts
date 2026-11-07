import type { BrowserContext, Page } from "playwright";
import { isLivePage } from "../live/pages.ts";

/** Una pestaña de trabajo. No toca la bandeja que se está mostrando. */
export async function openWorkPage(context: BrowserContext): Promise<Page> {
  const usable = context.pages().filter((page) => !isLivePage(page));
  const blanks = usable.filter((page) => page.url() === "about:blank");
  const busy = usable.some((page) => page.url() !== "about:blank");
  const page = busy ? await context.newPage() : (blanks[0] ?? await context.newPage());
  for (const blank of usable) {
    if (blank !== page && blank.url() === "about:blank") await blank.close().catch(() => undefined);
  }
  return page;
}
