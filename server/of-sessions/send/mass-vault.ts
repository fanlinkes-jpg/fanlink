import { massSendGate, type MassEnv } from "../../../src/lib/mass/gates.ts";
import { itemSaleBlocked, type SaleFolder } from "../sync/vault-block.ts";

export type MassVaultSale = {
  folderId: string | null;
  folderName: string | null;
  title: string | null;
  folders: readonly SaleFolder[];
};

/**
 * El masivo no sale si la compuerta está apagada o si la pieza (o un padre) es NO VENDER.
 * No abre red. El llamador solo recibe `open` cuando las dos dejan pasar.
 */
export async function deliverMassVault(input: {
  accountId: string;
  env: MassEnv;
  sales: readonly MassVaultSale[];
  open: () => Promise<void>;
}): Promise<{ sent: boolean; opened: boolean; reason: string | null }> {
  const gate = massSendGate(input.accountId, input.env);
  if (!gate.open) return { sent: false, opened: false, reason: gate.reason };
  if (input.sales.some((sale) => itemSaleBlocked(sale))) {
    return { sent: false, opened: false, reason: "NO VENDER" };
  }
  await input.open();
  return { sent: true, opened: true, reason: null };
}
