import { chmod, mkdir } from "node:fs/promises";

export async function preparePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}
