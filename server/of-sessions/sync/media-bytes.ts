import { mediaHostAllowed } from "./history.ts";

export async function readSessionMediaBytes(
  creatorId: string,
  target: string,
): Promise<{ status: number; body: Uint8Array; contentType: string } | null> {
  if (!mediaHostAllowed(target)) return null;
  try {
    const { getOfSessionManager } = await import("../../../src/lib/of-sessions-runtime.server.ts");
    const sessions = await getOfSessionManager();
    const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId);
    if (!account || account.status !== "active" || !account.hasStorageState) return null;
    return await sessions.withSession(account.id, async (context) => {
      const response = await context.request.get(target, { timeout: 15_000, maxRedirects: 0 });
      if (response.status() < 200 || response.status() >= 300) return null;
      const body = await response.body();
      const contentType = response.headers()["content-type"] ?? "application/octet-stream";
      return { status: response.status(), body, contentType };
    });
  } catch {
    return null;
  }
}
