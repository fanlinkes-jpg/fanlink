import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, rename, writeFile } from "node:fs/promises";
import type { StorageStateFile } from "./sessions/storage-state.ts";

const MAGIC = Buffer.from("FLS1");
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export class SessionCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionCryptoError";
  }
}

export function decodeSessionKey(raw: string): Buffer {
  const value = raw.trim();
  if (!value) {
    throw new SessionCryptoError(
      "FANLINK_SESSION_KEY tiene que ser 32 bytes en base64 o hex",
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new SessionCryptoError(
      "FANLINK_SESSION_KEY tiene que ser 32 bytes en base64 o hex",
    );
  }
  return key;
}

export function readSessionKey(raw: string | undefined): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  return decodeSessionKey(value);
}

export function encryptBytes(plain: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new SessionCryptoError(
      "FANLINK_SESSION_KEY tiene que ser 32 bytes en base64 o hex",
    );
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ciphertext]);
}

export function decryptBytes(payload: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new SessionCryptoError(
      "FANLINK_SESSION_KEY tiene que ser 32 bytes en base64 o hex",
    );
  }
  const header = MAGIC.length + IV_LENGTH + TAG_LENGTH;
  if (
    payload.length < header ||
    !payload.subarray(0, MAGIC.length).equals(MAGIC)
  ) {
    throw new SessionCryptoError(
      "El archivo de sesión no está cifrado con la clave actual",
    );
  }
  const iv = payload.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
  const tag = payload.subarray(MAGIC.length + IV_LENGTH, header);
  const ciphertext = payload.subarray(header);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new SessionCryptoError(
      "No se ha podido descifrar la sesión. Revisa FANLINK_SESSION_KEY.",
    );
  }
}

export async function writeEncryptedSession(
  filePath: string,
  state: StorageStateFile,
  key: Buffer,
): Promise<void> {
  const payload = encryptBytes(Buffer.from(JSON.stringify(state)), key);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, payload, { mode: 0o600 });
  await rename(tmp, filePath);
  await chmod(filePath, 0o600);
}
