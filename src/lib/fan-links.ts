/** Enlaces reales de OnlyFans de un fan y copia al portapapeles. */

/** onlyfans.com/<usuario>. Sin usuario, onlyfans.com/u<id> (OnlyFans también lo resuelve). */
export function fanProfileUrl(handle: string | null | undefined, fanKey: string | null | undefined): string | null {
  const name = handle?.replace(/^@/, "").trim();
  if (name && /^[A-Za-z0-9._-]{2,60}$/.test(name)) return `https://onlyfans.com/${name}`;
  const id = fanKey?.trim();
  return id && /^\d{1,18}$/.test(id) ? `https://onlyfans.com/u${id}` : null;
}

export function fanChatUrl(fanKey: string | null | undefined): string | null {
  const id = fanKey?.trim();
  return id && /^\d{1,18}$/.test(id) ? `https://onlyfans.com/my/chats/chat/${id}` : null;
}

/** Copia con la API moderna y, si el navegador la niega, con un textarea. Devuelve si se copió de verdad. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // cae al método antiguo
  }
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
