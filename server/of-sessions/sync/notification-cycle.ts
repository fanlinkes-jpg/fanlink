import type { NotificationPace } from "./api-list-pace.ts";
import { planNotificationPull, withAccountChatReader } from "./api-list-pace.ts";
import { accountPause } from "./backoff.ts";
import { shouldReadApiList, type ApiListAccount } from "./api-list-cycle.ts";
import { notificationLogLine, type CollectedNotifications } from "./of-notifications-api.ts";

/**
 * Una pasada del bucle real. 45 s, solo cuentas Activas con sesión,
 * el mismo lector que el chat. El aviso de omisión se olvida cuando
 * la cuenta vuelve a poder leerse. Un 400 del contador no pausa:
 * eso lo decide quien lee, dejando signatureRejected en false.
 */
export async function passNotificationAccounts<T extends ApiListAccount>(input: {
  accounts: readonly T[];
  noted: Set<string>;
  pace: Map<string, NotificationPace>;
  now: () => number;
  read: (account: T) => Promise<CollectedNotifications>;
  finish: (account: T, read: CollectedNotifications) => Promise<void>;
  onBlock: (accountId: string, reason: "400" | "429") => void;
  log?: (line: string) => void;
}): Promise<void> {
  const log = input.log ?? ((line: string) => console.info(line));
  for (const account of input.accounts) {
    if (shouldReadApiList(account, false)) input.noted.delete(account.id);
    if (!shouldReadApiList(account, accountPause(account.id, input.now()) != null)) {
      if (accountPause(account.id, input.now())) continue;
      if (input.noted.has(account.id)) continue;
      input.noted.add(account.id);
      const why = account.sessionRejected
        ? "sesión rechazada"
        : account.connection === "login_required"
          ? "login requerido"
          : account.hasStorageState === false
            ? "sin sesión guardada"
            : account.identityState === "mismatch"
              ? "no coincide"
              : account.status;
      log(notificationLogLine({ creatorId: account.creatorId ?? "-", route: "lista", count: 0, motivo: `se omite (${why})`, status: null }));
      continue;
    }
    await withAccountChatReader(account.id, async () => {
      const plan = planNotificationPull(input.pace.get(account.id), input.now());
      if (!plan.head) return;
      input.pace.set(account.id, plan.next);
      const read = await input.read(account);
      for (const route of read.routes) {
        log(notificationLogLine({
          creatorId: account.creatorId ?? "-",
          route: route.route,
          count: route.count,
          motivo: route.motivo,
          status: route.status,
        }));
      }
      if (read.signatureRejected) input.onBlock(account.id, "400");
      else if (read.retryAfterMs > 0) input.onBlock(account.id, "429");
      await input.finish(account, read);
    });
  }
}
