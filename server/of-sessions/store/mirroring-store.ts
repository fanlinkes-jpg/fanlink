import type { AccountRepository } from "./repository.ts";
import type { AccountStore } from "./account-store.ts";
import type { DbAccountStore } from "./db-account-store.ts";
import type { Account, AccountPatch } from "../types.ts";

/**
 * El archivo es el estado que usa el gestor de sesiones (sobrevive a un
 * PGLite en memoria). La tabla of_session_account refleja el vínculo con
 * la creadora para poder consultarlo en SQL.
 */
export function createMirroringStore(
  file: AccountStore,
  db: DbAccountStore,
): AccountRepository {
  return {
    async init() {
      await file.init();
      await db.init();
      const local = await file.list();
      if (local.length === 0) {
        for (const account of await db.list()) {
          await file.adopt(account);
        }
        return;
      }
      for (const account of local) {
        if (account.creatorId) await db.upsert(account);
      }
    },
    list: () => file.list(),
    get: (id) => file.get(id),
    findByCreator: (creatorId) => file.findByCreator(creatorId),
    async create(label: string, creatorId?: string | null) {
      const account = await file.create(label, creatorId);
      await sync(db, account);
      return account;
    },
    async update(id: string, patch: AccountPatch) {
      const account = await file.update(id, patch);
      await sync(db, account);
      return account;
    },
  };
}

async function sync(db: DbAccountStore, account: Account): Promise<void> {
  if (!account.creatorId) return;
  await db.upsert(account);
}
