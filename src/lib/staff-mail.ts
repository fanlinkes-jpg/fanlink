/** Correo de invitación con Resend. Sin RESEND_API_KEY no falla: devuelve sent=false y el enlace se copia a mano. */
export type MailEnv = { RESEND_API_KEY?: string; FANLINK_MAIL_FROM?: string };

export type MailResult =
  | { sent: true }
  | { sent: false; reason: "no-key" | "no-from" | "provider-error"; detail?: string };

export function inviteEmail(input: { name: string; link: string; agency?: string }): { subject: string; html: string; text: string } {
  const who = input.agency?.trim() || "Fanlink";
  const name = escapeHtml(input.name);
  const link = escapeHtml(input.link);
  return {
    subject: `${who}: te han invitado al equipo`,
    text: `Hola ${input.name},\n\nTe han invitado al CRM de ${who}. Abre este enlace, elige tu contraseña y entra:\n${input.link}\n\nEl enlace es de un solo uso y caduca en 7 días.`,
    html: `<p>Hola ${name},</p><p>Te han invitado al CRM de ${escapeHtml(who)}. Abre este enlace, elige tu contraseña y entra:</p><p><a href="${link}">${link}</a></p><p>El enlace es de un solo uso y caduca en 7 días.</p>`,
  };
}

export function resetEmail(input: { name: string; link: string; agency?: string }): { subject: string; html: string; text: string } {
  const who = input.agency?.trim() || "Fanlink";
  const name = escapeHtml(input.name);
  const link = escapeHtml(input.link);
  return {
    subject: `${who}: restablece tu contraseña`,
    text: `Hola ${input.name},\n\nAbre este enlace para elegir una contraseña nueva:\n${input.link}\n\nEl enlace es de un solo uso y caduca en 24 horas. Si no lo has pedido, ignora este correo.`,
    html: `<p>Hola ${name},</p><p>Abre este enlace para elegir una contraseña nueva:</p><p><a href="${link}">${link}</a></p><p>El enlace es de un solo uso y caduca en 24 horas. Si no lo has pedido, ignora este correo.</p>`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export async function sendInviteMail(
  input: { to: string; name: string; link: string; agency?: string },
  env: MailEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<MailResult> {
  return sendMail(input.to, inviteEmail(input), env, fetchImpl);
}

export async function sendResetMail(
  input: { to: string; name: string; link: string; agency?: string },
  env: MailEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<MailResult> {
  return sendMail(input.to, resetEmail(input), env, fetchImpl);
}

async function sendMail(
  to: string,
  mail: { subject: string; html: string; text: string },
  env: MailEnv,
  fetchImpl: typeof fetch,
): Promise<MailResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return { sent: false, reason: "no-key" };
  const from = env.FANLINK_MAIL_FROM?.trim();
  if (!from) return { sent: false, reason: "no-from" };
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      return { sent: false, reason: "provider-error", detail: `${response.status} ${detail}`.trim() };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: "provider-error", detail: error instanceof Error ? error.message : "sin respuesta" };
  }
}
