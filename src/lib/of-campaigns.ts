import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { CampaignDraftView } from "./campaign-runtime.server";

export type { CampaignDraftView };

export type CampaignPreview = { count: number; samples: string[] };

export const campaignSendFlag = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<{ sendEnabled: boolean }> => {
    const { sendEnabled } = await import("./campaign-runtime.server");
    return { sendEnabled: sendEnabled() };
  });

export const previewRealCampaign = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; segment: string; body: string; minSpentCents: number; quietDays: number }) => input)
  .handler(async ({ context, data }): Promise<CampaignPreview> => {
    const { previewCampaignView } = await import("./campaign-runtime.server");
    return previewCampaignView(context.userId, data);
  });

export const saveRealCampaign = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      creatorId: string;
      name: string;
      segment: string;
      body: string;
      priceCents: number | null;
      vaultIds: string[];
      scheduledAt: string | null;
      minSpentCents: number;
      quietDays: number;
    }) => input,
  )
  .handler(async ({ context, data }): Promise<CampaignDraftView> => {
    const { saveCampaignDraftView } = await import("./campaign-runtime.server");
    return saveCampaignDraftView(context.userId, data);
  });

export const listRealCampaigns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<CampaignDraftView[]> => {
    const { listCampaignDraftViews } = await import("./campaign-runtime.server");
    return listCampaignDraftViews(context.userId);
  });

export const sendRealCampaign = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async (): Promise<{ ok: false; reason: string }> => {
    const { refuseRealSend } = await import("./campaign-runtime.server");
    return refuseRealSend();
  });
