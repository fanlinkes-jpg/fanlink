import type { Account, AccountPatch } from "../types.ts";

export interface AccountRepository {
  init(): Promise<void>;
  list(): Promise<Account[]>;
  get(id: string): Promise<Account>;
  findByCreator(creatorId: string): Promise<Account | undefined>;
  create(label: string, creatorId?: string | null): Promise<Account>;
  update(id: string, patch: AccountPatch): Promise<Account>;
}
