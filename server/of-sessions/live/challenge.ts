export const LIVE_CHALLENGE_NOTICE =
  "OnlyFans ha detenido la página en una comprobación antibots («Just a moment»). Esta vista usa el mismo Chromium visible que Conectar. Si el aviso no desaparece en unos segundos, cierra la vista, pulsa Reconectar en esa cuenta y ábrela otra vez.";

/** Detecta el intersticial antibots de OnlyFans / Cloudflare sin inspeccionar cookies. */
export function isLiveChallengeText(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[’‘]/g, "'");
  return (
    normalized.includes("just a moment") ||
    normalized.includes("try your destination again") ||
    normalized.includes("checking if the site connection is secure")
  );
}
