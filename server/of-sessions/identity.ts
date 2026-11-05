export type IdentityState = "unavailable" | "verified";

/**
 * La identidad solo sale de un selector declarado por el adaptador del sitio.
 * Sin selector, o con el texto vacío, el resultado es no verificable.
 * No se interpreta ninguna cookie como nombre.
 */
export function identityFromProbe(
  selector: string | undefined,
  text: string | null,
): { identityState: IdentityState; identityLabel: string | null } {
  if (!selector) return { identityState: "unavailable", identityLabel: null };
  const label = (text ?? "").replace(/\s+/g, " ").trim();
  if (!label) return { identityState: "unavailable", identityLabel: null };
  return { identityState: "verified", identityLabel: label.slice(0, 80) };
}
