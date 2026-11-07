import { sessionErrorText } from "@/lib/use-creator-sessions";
import { sendChatMessage } from "@/lib/of-sessions";
import { chatSendSession } from "@/lib/chat-send-session";

/** El transporte no vive en Mensajes: salir de la sección no lo deja congelado. */
export function installChatSendTransport(): void {
  chatSendSession.setTransport(async (job) => {
    try {
      const result = await sendChatMessage({
        data: {
          creatorId: job.creatorId,
          fanKey: job.fanKey,
          threadKey: job.threadKey,
          body: job.body,
          priceCents: job.priceCents,
          vaultItemIds: job.vault.map((item) => item.id),
          clientId: job.clientId,
        },
      });
      return { sent: result.sent, reason: result.reason, messageId: result.messageId };
    } catch (error) {
      return { sent: false, reason: sessionErrorText(error), messageId: null };
    }
  });
}
