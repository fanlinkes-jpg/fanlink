import assert from "node:assert/strict";
import { test } from "node:test";
import { OutboundClaimError, reviewAwaitingView } from "../send/chat-message.ts";

test("un miembro no revisa un pendiente: 403, no un error genérico", async () => {
  await assert.rejects(
    () => reviewAwaitingView(
      { clientId: "11111111-1111-4111-8111-111111111111" },
      {
        sql: { query: async () => { throw new Error("no debe leer"); } },
        access: { userId: "member-1", role: "member", perms: ["mensajes"], creatorIds: [] },
      },
    ),
    (error: unknown) => (
      error instanceof OutboundClaimError
      && error.status === 403
      && error.message === "Solo la dueña puede marcar esto como revisado."
    ),
  );
});
