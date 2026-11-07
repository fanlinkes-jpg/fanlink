import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { WorkspaceAccessError } from "../../../src/lib/access-policy.ts";
import { discardOutboundView, OutboundClaimError, sendChatMessageView, type SendChatHooks } from "../send/chat-message.ts";
import { sendClaimKey } from "../send/claim.ts";
import { listPendingOutbounds, markOutboundAwaiting, recordOutbound } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FILES = [
  "0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql",
  "0019_chat_author.sql", "0024_outbound_schedule.sql", "0025_outbound_send.sql",
  "0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0039_outbound_media.sql",
  "0040_vault_full_tags.sql", "0041_send_claim.sql", "0042_vault_paid_with.sql",
];

const account = { id: "acc-9", creatorId: "9ikis52", identityHandle: "bigpoppa1111", identityUserId: "42", identityState: "ok", label: "Prueba" };
const access = { userId: "chatter-a", role: "member" as const, perms: ["mensajes"], creatorIds: ["9ikis52", "otra"] };
const env = { FANLINK_ENABLE_SEND: "true", FANLINK_SEND_ALLOW_ACCOUNTS: "9ikis52,@bigpoppa1111" };

test("el clientId del cliente es el id de la fila y no se duplica", async () => {
  const db = new PGlite();
  try {
    await apply(db);
    await db.exec("insert into staff_profile (user_id, display_name, role) values ('chatter-a', 'Ana', 'member')");
    const sql = asSql(db);
    const clientId = crypto.randomUUID();
    let opened = 0;
    const open: SendChatHooks["open"] = async () => {
      opened += 1;
      return { messageId: "m-1", reason: null };
    };
    const sent = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "hola", priceCents: 500, clientId, authorId: "dueña",
    } as Parameters<typeof sendChatMessageView>[1], hooks(sql, open));
    assert.equal(sent.sent, true);
    assert.equal(sent.messageId, "m-1");
    const rows = await db.query<{ id: string; author_id: string; status: string; body: string }>(
      "select id, author_id, status, body from of_chat_outbound",
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]?.id, clientId);
    assert.equal(rows.rows[0]?.author_id, "chatter-a");
    assert.equal(rows.rows[0]?.status, "sent");
    assert.equal(rows.rows[0]?.body, "hola");
    await assert.rejects(
      () => sendChatMessageView("chatter-a", {
        creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "hola", priceCents: 500, clientId,
      }, hooks(sql, open)),
      (error: unknown) => error instanceof OutboundClaimError && error.status === 409,
    );
    assert.equal(opened, 1);
    assert.equal(await count(db, "of_chat_outbound"), 1);
    assert.equal(await count(db, "of_vault_fan_send"), 0);
  } finally {
    await db.close();
  }
});

test("con los flags apagados no se abre el navegador y ninguna fila queda enviada", async () => {
  const db = new PGlite();
  try {
    await apply(db);
    const sql = asSql(db);
    let opened = false;
    const result = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "hola", priceCents: null, clientId: crypto.randomUUID(),
    }, hooks(sql, async () => {
      opened = true;
      return { messageId: "no", reason: null };
    }, {}));
    assert.equal(result.sent, false);
    assert.equal(result.reason, "Envío real desactivado");
    assert.equal(opened, false);
    const sent = await db.query<{ n: number }>("select count(*)::int as n from of_chat_outbound where status = 'sent'");
    assert.equal(Number(sent.rows[0]?.n ?? 0), 0);
  } finally {
    await db.close();
  }
});

test("un clientId inválido se rechaza", async () => {
  const db = new PGlite();
  try {
    await apply(db);
    const sql = asSql(db);
    let opened = false;
    const open: SendChatHooks["open"] = async () => {
      opened = true;
      return { messageId: "1", reason: null };
    };
    for (const clientId of ["no-es-uuid", "ffffffff-ffff-ffff-ffff-ffffffffffff", "123"]) {
      await assert.rejects(
        () => sendChatMessageView("chatter-a", {
          creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "hola", priceCents: null, clientId,
        }, hooks(sql, open)),
        (error: unknown) => error instanceof WorkspaceAccessError && error.message === "clientId no válido",
      );
    }
    assert.equal(opened, false);
    assert.equal(await count(db, "of_chat_outbound"), 0);
  } finally {
    await db.close();
  }
});

test("un chatter no reutiliza el clientId de otro, ni de otra creadora u otro hilo", async () => {
  const db = new PGlite();
  try {
    await apply(db);
    await db.exec(`insert into staff_profile (user_id, display_name, role) values
      ('chatter-a', 'Ana', 'member'),
      ('chatter-b', 'Bea', 'member')`);
    const sql = asSql(db);
    const clientId = crypto.randomUUID();
    let opened = 0;
    const open: SendChatHooks["open"] = async () => {
      opened += 1;
      return { messageId: null, reason: "no enviado" };
    };
    const failed = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "secreto del otro", priceCents: null, clientId,
    }, hooks(sql, open));
    assert.equal(failed.reason, "no enviado");
    const intruder = hooks(sql, open);
    intruder.access = { ...access, userId: "chatter-b" };
    await assert.rejects(
      () => sendChatMessageView("chatter-b", {
        creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "secreto del otro", priceCents: null, clientId,
      }, intruder),
      (error: unknown) => {
        assert.ok(error instanceof OutboundClaimError);
        assert.equal(error.status, 403);
        assert.equal(error.message.includes("secreto"), false);
        return true;
      },
    );
    await assert.rejects(
      () => sendChatMessageView("chatter-a", {
        creatorId: "9ikis52", fanKey: "7", threadKey: "otro", body: "secreto del otro", priceCents: null, clientId,
      }, hooks(sql, open)),
      (error: unknown) => error instanceof OutboundClaimError && error.status === 409 && !error.message.includes("secreto"),
    );
    await assert.rejects(
      () => sendChatMessageView("chatter-a", {
        creatorId: "otra", fanKey: "7", threadKey: "7", body: "secreto del otro", priceCents: null, clientId,
      }, hooks(sql, open)),
      (error: unknown) => error instanceof OutboundClaimError && error.status === 409,
    );
    assert.equal(opened, 1);
    const row = await db.query<{ author_id: string; body: string; status: string; creator_id: string; thread_key: string }>(
      "select author_id, body, status, creator_id, thread_key from of_chat_outbound where id = $1",
      [clientId],
    );
    assert.equal(row.rows[0]?.author_id, "chatter-a");
    assert.equal(row.rows[0]?.body, "secreto del otro");
    assert.equal(row.rows[0]?.status, "error");
    assert.equal(row.rows[0]?.creator_id, "9ikis52");
    assert.equal(row.rows[0]?.thread_key, "7");
    assert.equal(await count(db, "of_chat_outbound"), 1);
  } finally {
    await db.close();
  }
});

test("una fila awaiting o enviada no se reintenta aunque hayan pasado 30 s", async () => {
  const db = new PGlite();
  try {
    await apply(db);
    await db.exec("insert into staff_profile (user_id, display_name, role) values ('chatter-a', 'Ana', 'member')");
    const sql = asSql(db);
    const waitingId = crypto.randomUUID();
    const sentId = crypto.randomUUID();
    let opened = 0;
    const waiting = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "a medias", priceCents: null, clientId: waitingId,
    }, hooks(sql, async () => {
      opened += 1;
      return { messageId: null, reason: null, awaitingId: true };
    }));
    assert.equal(waiting.reason, "Pendiente de confirmar");
    const sent = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "ya salió", priceCents: null, clientId: sentId,
    }, hooks(sql, async () => {
      opened += 1;
      return { messageId: "m-9", reason: null };
    }));
    assert.equal(sent.sent, true);
    await db.exec("update of_chat_send_claim set created_at = now() - interval '31 seconds'");
    await assert.rejects(
      () => sendChatMessageView("chatter-a", {
        creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "a medias", priceCents: null, clientId: waitingId,
      }, hooks(sql, async () => {
        opened += 1;
        return { messageId: "no", reason: null };
      })),
      (error: unknown) => error instanceof OutboundClaimError && error.status === 409,
    );
    await assert.rejects(
      () => sendChatMessageView("chatter-a", {
        creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "ya salió", priceCents: null, clientId: sentId,
      }, hooks(sql, async () => {
        opened += 1;
        return { messageId: "tampoco", reason: null };
      })),
      (error: unknown) => error instanceof OutboundClaimError && error.status === 409,
    );
    await assert.rejects(
      () => discardOutboundView({ clientId: waitingId }, { sql, access }),
      (error: unknown) => error instanceof OutboundClaimError && error.status === 409,
    );
    await assert.rejects(
      () => discardOutboundView({ clientId: sentId }, { sql, access }),
      (error: unknown) => error instanceof OutboundClaimError && error.status === 409,
    );
    assert.equal(opened, 2);
    const rows = await db.query<{ id: string; status: string; error_reason: string | null; of_message_key: string | null }>(
      "select id, status, error_reason, of_message_key from of_chat_outbound order by body",
    );
    const pending = rows.rows.find((row) => row.id === waitingId);
    const done = rows.rows.find((row) => row.id === sentId);
    assert.equal(pending?.status, "pending");
    assert.equal(pending?.error_reason, "Pendiente de confirmar");
    assert.equal(done?.status, "sent");
    assert.equal(done?.of_message_key, "m-9");
    assert.equal(await count(db, "of_chat_outbound"), 2);
  } finally {
    await db.close();
  }
});

test("reintentar un error reutiliza el clientId y no crea otra fila", async () => {
  const db = new PGlite();
  try {
    await apply(db);
    await db.exec("insert into staff_profile (user_id, display_name, role) values ('chatter-a', 'Ana', 'member')");
    const sql = asSql(db);
    const clientId = crypto.randomUUID();
    let opened = 0;
    const first = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "hola", priceCents: 500, clientId,
    }, hooks(sql, async () => {
      opened += 1;
      return { messageId: null, reason: "no enviado" };
    }));
    assert.equal(first.sent, false);
    assert.equal(first.reason, "no enviado");
    const again = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "texto distinto", priceCents: 100, clientId,
    }, hooks(sql, async () => {
      opened += 1;
      return { messageId: "m-2", reason: null };
    }));
    assert.equal(again.sent, true);
    assert.equal(again.messageId, "m-2");
    assert.equal(opened, 2);
    const rows = await db.query<{ id: string; body: string; price_cents: number | string | null; author_id: string; status: string }>(
      "select id, body, price_cents, author_id, status from of_chat_outbound",
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]?.id, clientId);
    assert.equal(rows.rows[0]?.body, "hola");
    assert.equal(Number(rows.rows[0]?.price_cents), 500);
    assert.equal(rows.rows[0]?.author_id, "chatter-a");
    assert.equal(rows.rows[0]?.status, "sent");
  } finally {
    await db.close();
  }
});

test("NO VENDER y el precio mínimo devuelven el motivo y no abren el navegador", async () => {
  const db = new PGlite();
  try {
    await apply(db);
    await db.exec("insert into of_vault_list (creator_id, list_key, name) values ('9ikis52', 'nv', 'NO VENDER')");
    await db.exec("insert into of_vault_item (creator_id, item_key, title, folder, list_key, list_name) values ('9ikis52', 'v1', 'clip', 'NO VENDER', 'nv', 'NO VENDER')");
    const sql = asSql(db);
    let opened = false;
    const open: SendChatHooks["open"] = async () => {
      opened = true;
      return { messageId: "1", reason: null };
    };
    const cheap = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "barato", priceCents: 100, clientId: crypto.randomUUID(),
    }, hooks(sql, open));
    assert.equal(cheap.sent, false);
    assert.equal(cheap.reason, "Mínimo $3 USD o gratis");
    const blocked = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "mira", priceCents: null, vaultItemIds: ["v1"], clientId: crypto.randomUUID(),
    }, hooks(sql, open));
    assert.equal(blocked.sent, false);
    assert.equal(blocked.reason, "NO VENDER");
    const titled = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "mira", priceCents: null, vaultTitle: "clip",
    } as Parameters<typeof sendChatMessageView>[1], hooks(sql, open));
    assert.equal(titled.reason, "NO VENDER");
    assert.equal(opened, false);
    assert.equal(await count(db, "of_chat_outbound"), 0);
    assert.equal(await count(db, "of_vault_fan_send"), 0);
  } finally {
    await db.close();
  }
});

test("dos autores con el mismo texto no comparten la clave y salen los dos", async () => {
  const keyA = sendClaimKey({ authorId: "chatter-a", creatorId: "9ikis52", threadKey: "7", fanKey: "7", body: "hola", priceCents: null, vaultItemIds: [] });
  const keyB = sendClaimKey({ authorId: "chatter-b", creatorId: "9ikis52", threadKey: "7", fanKey: "7", body: "hola", priceCents: null, vaultItemIds: [] });
  assert.notEqual(keyA, keyB);
  const db = new PGlite();
  try {
    await apply(db);
    await db.exec(`insert into staff_profile (user_id, display_name, role) values
      ('chatter-a', 'Ana', 'member'),
      ('chatter-b', 'Bea', 'member')`);
    const sql = asSql(db);
    let opened = 0;
    const open: SendChatHooks["open"] = async () => {
      opened += 1;
      return { messageId: `m-${opened}`, reason: null };
    };
    const first = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "hola", priceCents: null, clientId: crypto.randomUUID(),
    }, hooks(sql, open));
    const other = hooks(sql, open);
    other.access = { ...access, userId: "chatter-b" };
    const second = await sendChatMessageView("chatter-b", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "hola", priceCents: null, clientId: crypto.randomUUID(),
    }, other);
    assert.equal(first.sent, true);
    assert.equal(second.sent, true);
    assert.equal(opened, 2);
    assert.equal(await count(db, "of_chat_outbound"), 2);
  } finally {
    await db.close();
  }
});

test("si el navegador ya se abrió y falla, queda pendiente de confirmar y no se reintenta", async () => {
  const db = new PGlite();
  try {
    await apply(db);
    await db.exec("insert into staff_profile (user_id, display_name, role) values ('chatter-a', 'Ana', 'member')");
    const sql = asSql(db);
    const clientId = crypto.randomUUID();
    let opened = 0;
    const result = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "a medias", priceCents: null, clientId,
    }, hooks(sql, async () => {
      opened += 1;
      throw new Error("se cayó la pestaña");
    }));
    assert.equal(result.sent, false);
    assert.equal(result.reason, "Pendiente de confirmar");
    await db.exec("update of_chat_send_claim set created_at = now() - interval '31 seconds'");
    await assert.rejects(
      () => sendChatMessageView("chatter-a", {
        creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "a medias", priceCents: null, clientId,
      }, hooks(sql, async () => {
        opened += 1;
        return { messageId: "otra", reason: null };
      })),
      (error: unknown) => error instanceof OutboundClaimError && error.status === 409,
    );
    assert.equal(opened, 1);
    const row = await db.query<{ status: string; error_reason: string | null }>(
      "select status, error_reason from of_chat_outbound where id = $1",
      [clientId],
    );
    assert.equal(row.rows[0]?.status, "pending");
    assert.equal(row.rows[0]?.error_reason, "Pendiente de confirmar");
  } finally {
    await db.close();
  }
});

test("un pending atascado caduca, conserva precio y piezas, y su autor lo descarta", async () => {
  const db = new PGlite();
  try {
    await apply(db);
    await db.exec(`insert into staff_profile (user_id, display_name, role) values
      ('chatter-a', 'Ana', 'member'),
      ('chatter-b', 'Bea', 'member')`);
    const sql = asSql(db);
    const stuckId = crypto.randomUUID();
    const freshId = crypto.randomUUID();
    const waitingId = crypto.randomUUID();
    const scheduledId = crypto.randomUUID();
    await recordOutbound(sql, {
      id: stuckId,
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      creatorId: "9ikis52",
      fanKey: "7",
      threadKey: "7",
      authorId: "chatter-a",
      body: "colgado",
      priceCents: 500,
      ofMessageKey: null,
    });
    await db.exec(`insert into of_vault_item (creator_id, item_key, title) values ('9ikis52', 'v1', 'playa')`);
    await db.query("insert into of_outbound_media (outbound_id, creator_id, media_id, position) values ($1, '9ikis52', 'v1', 0)", [stuckId]);
    await recordOutbound(sql, {
      id: freshId,
      createdAt: new Date().toISOString(),
      creatorId: "9ikis52",
      fanKey: "7",
      threadKey: "7",
      authorId: "chatter-a",
      body: "recién",
      priceCents: null,
      ofMessageKey: null,
    });
    await recordOutbound(sql, {
      id: waitingId,
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      creatorId: "9ikis52",
      fanKey: "7",
      threadKey: "7",
      authorId: "chatter-a",
      body: "esperando",
      priceCents: null,
      ofMessageKey: null,
    });
    await markOutboundAwaiting(sql, waitingId);
    await recordOutbound(sql, {
      id: scheduledId,
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      scheduledAt: "2026-12-01T18:00:00.000Z",
      creatorId: "9ikis52",
      fanKey: "7",
      threadKey: "7",
      authorId: "chatter-a",
      body: "luego",
      priceCents: null,
      ofMessageKey: null,
    });
    const pending = await listPendingOutbounds(sql, ["9ikis52"]);
    const stuck = pending.find((item) => item.id === stuckId);
    assert.equal(stuck?.status, "error");
    assert.equal(stuck?.errorReason, "se interrumpió");
    assert.equal(stuck?.priceCents, 500);
    assert.equal(stuck?.authorId, "chatter-a");
    assert.deepEqual(stuck?.vault, [{ id: "v1", name: "playa" }]);
    assert.equal(pending.find((item) => item.id === freshId)?.status, "pending");
    assert.equal(pending.find((item) => item.id === waitingId)?.errorReason, "Pendiente de confirmar");
    assert.equal(pending.find((item) => item.id === scheduledId)?.status, "pending");
    await assert.rejects(
      () => discardOutboundView({ clientId: freshId }, { sql, access }),
      (error: unknown) => error instanceof OutboundClaimError && error.status === 409,
    );
    await assert.rejects(
      () => discardOutboundView({ clientId: waitingId }, { sql, access }),
      (error: unknown) => error instanceof OutboundClaimError && error.status === 409,
    );
    const intruder = { ...access, userId: "chatter-b" };
    await assert.rejects(
      () => discardOutboundView({ clientId: stuckId }, { sql, access: intruder }),
      (error: unknown) => error instanceof OutboundClaimError && error.status === 403 && error.message === "No es tuyo",
    );
    const still = await db.query<{ status: string }>("select status from of_chat_outbound where id = $1", [stuckId]);
    assert.equal(still.rows[0]?.status, "error");
    assert.deepEqual(await discardOutboundView({ clientId: stuckId }, { sql, access }), { ok: true });
    const gone = (await listPendingOutbounds(sql, ["9ikis52"])).find((item) => item.id === stuckId);
    assert.equal(gone, undefined);
  } finally {
    await db.close();
  }
});

function hooks(sql: ReadSql, open: SendChatHooks["open"], flags: NodeJS.ProcessEnv = env): SendChatHooks {
  return { sql, access: { ...access, perms: [...access.perms], creatorIds: [...access.creatorIds] }, account, env: flags, open };
}

function asSql(db: PGlite): ReadSql {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
}

async function apply(db: PGlite): Promise<void> {
  for (const file of FILES) await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
}

async function count(db: PGlite, table: string): Promise<number> {
  const result = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return Number(result.rows[0]?.n ?? 0);
}
