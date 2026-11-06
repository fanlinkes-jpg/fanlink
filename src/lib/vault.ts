import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

// El handler corre en el servidor. El import va dentro para que el navegador
// no cargue Playwright ni el gestor de sesiones.

export type VaultViewItem = {
  id: string;
  title: string | null;
  kind: "foto" | "video" | "audio" | null;
  seconds: number | null;
  hasPreview: boolean;
  createdAt: string | null;
  folderId: string | null;
  tags: Array<"sent" | "feed">;
  priceCents: number | null;
  sales: number | null;
  trailer: boolean;
  couple: "B/G" | "G/G" | "INDIVIDUAL" | "SOLA" | "PELICULA" | null;
  act: string | null;
  blocked: "NO VENDER" | "SIN EDITAR" | null;
};

export type VaultView = {
  items: VaultViewItem[];
  folders: Array<{ id: string; name: string; parentId: string | null }>;
  notice: string | null;
};

export const listVault = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string }) => input)
  .handler(async ({ context, data }): Promise<VaultView> => {
    const { listVaultView } = await import("./vault-runtime.server");
    return listVaultView(context.userId, data.creatorId);
  });

export const syncVault = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; mode: "sync" | "continue" }) => input)
  .handler(async ({ context, data }): Promise<{ notice: string | null }> => {
    const { syncVaultView } = await import("./vault-runtime.server");
    return syncVaultView(context.userId, data.creatorId, data.mode);
  });
