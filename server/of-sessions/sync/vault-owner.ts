import type { SessionManager } from "../sessions/session-manager.ts";
import type { ThumbBrowser } from "./vault-thumbs.ts";

/**
 * Pide los bytes al perfil que ya posee la cuenta. Si no hay ninguno abierto,
 * `borrowProfile` abre uno. No lanza un segundo Chromium.
 */
export async function openProfileThumbs(
  sessions: Pick<SessionManager, "borrowProfile">,
  accountId: string,
): Promise<ThumbBrowser | null> {
  try {
    const borrowed = await sessions.borrowProfile(accountId);
    return {
      async get(url: string) {
        const response = await borrowed.context.request.get(url, {
          headers: {
            referer: "https://onlyfans.com/",
            accept: "image/avif,image/webp,image/*,*/*",
          },
          timeout: 15_000,
          maxRedirects: 3,
        });
        const type = (response.headers()["content-type"] ?? "").split(";")[0]?.trim() ?? "";
        const raw = new Uint8Array(await response.body());
        return { ok: response.ok(), status: response.status(), body: raw, contentType: type };
      },
      release: () => borrowed.release(),
    };
  } catch {
    return null;
  }
}
