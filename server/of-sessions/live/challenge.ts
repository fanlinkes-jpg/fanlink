export const LIVE_CHALLENGE_NOTICE =
  "OnlyFans muestra la comprobación antibots («Just a moment»). Haz clic en el recuadro dentro de esta vista y, si pide texto, teclea aquí: no se abre ninguna ventana. Cuando pase, la cookie queda en el perfil de la cuenta y la próxima apertura la reutiliza.";

export const LIVE_LOGIN_NOTICE =
  "OnlyFans muestra el inicio de sesión. Esta vista no ha guardado nada. Si la API pide reconectar, pulsa Reconectar una vez y entra en la ventana de Conectar: la vista usará esa misma huella y no volverá a invalidar la sesión.";

/** El formulario de entrada, sin mirar cookies ni contraseñas. */
export function isLiveLoginText(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[’‘]/g, "'");
  return normalized.includes("iniciar sesión") || normalized.includes("log in to onlyfans");
}

/** Detecta el intersticial antibots de OnlyFans / Cloudflare sin inspeccionar cookies. */
export function isLiveChallengeText(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[’‘]/g, "'");
  return (
    normalized.includes("just a moment") ||
    normalized.includes("try your destination again") ||
    normalized.includes("checking if the site connection is secure")
  );
}
