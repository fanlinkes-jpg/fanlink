import type { SessionManager } from "../sessions/session-manager.ts";
import type { ThumbBrowser } from "./vault-thumbs.ts";

/**
 * Pide los bytes al dueño único del perfil (`borrowProfile` → `profiles.lease`)
 * y suelta el lease al terminar. Si el perfil ya está abierto, reutiliza ese
 * Chromium. Sin ese dueño, el `borrowProfile` anterior (session-manager.ts:316-328
 * en f6b3729) abría un contexto propio y `runLogin` (:706-714, `launchPersistentContext`)
 * podía abrir otro sobre el mismo `data/profiles/<cuenta>`.
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
