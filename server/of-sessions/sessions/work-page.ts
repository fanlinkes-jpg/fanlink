import type { BrowserContext, Page } from "playwright";

/** Una pestaña de trabajo. Si el perfil acaba de abrirse, usa su about:blank en vez de dejarlo huérfano. */
export async function openWorkPage(context: BrowserContext): Promise<Page> {
  const blanks = context.pages().filter((page) => page.url() === "about:blank");
  const busy = context.pages().some((page) => page.url() !== "about:blank");
  const page = busy ? await context.newPage() : (blanks[0] ?? await context.newPage());
  for (const blank of context.pages()) {
    if (blank !== page && blank.url() === "about:blank") await blank.close().catch(() => undefined);
  }
  return page;
}
