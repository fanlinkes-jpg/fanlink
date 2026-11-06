/**
 * Aviso de WhatsApp. Sin credenciales no llama a nadie: escribe en el log.
 * Twilio y la Cloud API se eligen por variables. No hay claves en el código.
 */

export type AlertMessage = {
  to: string;
  body: string;
};

export type AlertSendResult = {
  ok: boolean;
  provider: "simulated" | "twilio" | "cloud";
  simulated: boolean;
};

export type AlertSender = (message: AlertMessage) => Promise<AlertSendResult>;

export type WhatsAppEnv = {
  FANLINK_WHATSAPP_PROVIDER?: string;
  FANLINK_TWILIO_ACCOUNT_SID?: string;
  FANLINK_TWILIO_AUTH_TOKEN?: string;
  FANLINK_TWILIO_WHATSAPP_FROM?: string;
  FANLINK_WHATSAPP_TOKEN?: string;
  FANLINK_WHATSAPP_PHONE_ID?: string;
  FANLINK_ALERT_QUIET_MIN?: string;
  /** all (defecto), assigned o users. */
  FANLINK_ALERT_MODE?: string;
  /** Lista de user id cuando el modo es users. */
  FANLINK_ALERT_USERS?: string;
};

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `***${digits.slice(-4)}`;
}

export function normalizePhone(value: string): string | null {
  const compact = value.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) return null;
  return compact;
}

export function createWhatsAppSender(env: WhatsAppEnv, fetchImpl: typeof fetch = fetch): AlertSender {
  const mode = (env.FANLINK_WHATSAPP_PROVIDER ?? "").trim().toLowerCase();
  const twilioReady =
    mode === "twilio" &&
    Boolean(env.FANLINK_TWILIO_ACCOUNT_SID && env.FANLINK_TWILIO_AUTH_TOKEN && env.FANLINK_TWILIO_WHATSAPP_FROM);
  const cloudReady = mode === "cloud" && Boolean(env.FANLINK_WHATSAPP_TOKEN && env.FANLINK_WHATSAPP_PHONE_ID);
  if (twilioReady) return (message) => sendTwilio(env, message, fetchImpl);
  if (cloudReady) return (message) => sendCloud(env, message, fetchImpl);
  return async (message) => {
    console.info(`[fanlink:whatsapp] simulado to=${maskPhone(message.to)} body=${message.body}`);
    return { ok: true, provider: "simulated", simulated: true };
  };
}

async function sendTwilio(env: WhatsAppEnv, message: AlertMessage, fetchImpl: typeof fetch): Promise<AlertSendResult> {
  const sid = env.FANLINK_TWILIO_ACCOUNT_SID ?? "";
  const token = env.FANLINK_TWILIO_AUTH_TOKEN ?? "";
  const from = env.FANLINK_TWILIO_WHATSAPP_FROM ?? "";
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const body = new URLSearchParams({
    To: `whatsapp:${message.to}`,
    From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    Body: message.body,
  });
  const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return { ok: response.ok, provider: "twilio", simulated: false };
}

async function sendCloud(env: WhatsAppEnv, message: AlertMessage, fetchImpl: typeof fetch): Promise<AlertSendResult> {
  const phoneId = env.FANLINK_WHATSAPP_PHONE_ID ?? "";
  const response = await fetchImpl(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneId)}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.FANLINK_WHATSAPP_TOKEN ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: message.to.replace(/^\+/, ""),
      type: "text",
      text: { body: message.body },
    }),
  });
  return { ok: response.ok, provider: "cloud", simulated: false };
}
