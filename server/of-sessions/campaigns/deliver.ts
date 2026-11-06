import type { Page } from "playwright";
import { mediaSendGate } from "../send/media-gate.ts";
import { sendGate } from "./segment.ts";

export type DraftDelivery = {
  fanKey: string;
  body: string;
  priceCents: number | null;
  mediaCount?: number;
};

/** Rellena el formulario del simulador. No abre OnlyFans. */
export async function deliverDrafts(
  page: Page,
  input: { flag: string | undefined; hostname: string; formUrl: string; drafts: DraftDelivery[] },
): Promise<{ delivered: number; reason: string | null }> {
  const gate = sendGate(input.flag, input.hostname);
  if (!gate.allowed) return { delivered: 0, reason: gate.reason };
  let delivered = 0;
  for (const draft of input.drafts) {
    const media = mediaSendGate(draft.mediaCount ?? 0);
    if (!media.allowed) return { delivered, reason: media.reason };
    await page.goto(input.formUrl, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="fan"]', draft.fanKey);
    await page.fill('textarea[name="body"]', draft.body);
    await page.fill('input[name="price"]', draft.priceCents == null ? "" : String(draft.priceCents));
    await Promise.all([
      page.waitForURL(/\/simulate-sent$/),
      page.click('button[type="submit"]'),
    ]);
    delivered += 1;
  }
  return { delivered, reason: null };
}
