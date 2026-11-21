const MAX_URL = 400;

/** Foto de perfil de users/me. Solo https, sin query ni usuario. */
export function creatorAvatarOf(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const user = asRecord(record.user) ?? record;
  return httpsAvatar(user.avatar) ?? thumb(user.avatarThumbs);
}

function thumb(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  return httpsAvatar(record.c144) ?? httpsAvatar(record.c50);
}

function httpsAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean.startsWith("https://") || clean.length > MAX_URL) return null;
  try {
    const url = new URL(clean);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
