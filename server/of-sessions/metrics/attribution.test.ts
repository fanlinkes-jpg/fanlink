import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { persistAttributions, readAttributions, readMassLaunches } from "./attribution-store.ts";
import { attributeSales, chatterReports, type TeamMessage, type TeamSale } from "./team.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function msg(partial: Partial<TeamMessage> & Pick<TeamMessage, "key" | "at" | "authorId">): TeamMessage {
  return { creatorId: "alba", threadKey: "7", fanKey: "7", fromFan: false, priceCents: null, purchased: null, authorName: null, massId: null, ...partial };
}

function sale(partial: Partial<TeamSale> & Pick<TeamSale, "key" | "at" | "kind" | "grossCents">): TeamSale {
  return { creatorId: "alba", fanKey: "7", ...partial };
}

const NAMES = { ana: "Ana", beto: "Beto" };

test("PPV: la venta es de quien envió ese mensaje, aunque otro hable después", () => {
  const messages = [
    msg({ key: "p1", at: "2026-11-03T10:00:00.000Z", authorId: "ana", authorName: NAMES.ana, priceCents: 1500, purchased: true }),
    msg({ key: "t1", at: "2026-11-03T10:30:00.000Z", authorId: "beto", authorName: NAMES.beto }),
  ];
  const [row] = attributeSales({
    messages,
    sales: [sale({ key: "ppv:alba:p1", at: "2026-11-03T11:00:00.000Z", kind: "ppv", grossCents: 1500, messageKey: "p1" })],
  });
  assert.deepEqual([row?.chatterId, row?.chatterName, row?.rule, row?.kind], ["ana", "Ana", "sender", "ppv"]);
});

test("masivo: la venta es de quien lo lanzó, no de quien habló con el fan", () => {
  const messages = [
    msg({ key: "talk", at: "2026-11-03T09:00:00.000Z", authorId: "beto", authorName: NAMES.beto }),
    msg({ key: "mass1", at: "2026-11-03T10:00:00.000Z", authorId: null, priceCents: 2000, purchased: true, massId: "mm1" }),
  ];
  const sales = [sale({ key: "ppv:alba:mass1", at: "2026-11-03T11:00:00.000Z", kind: "ppv", grossCents: 2000, messageKey: "mass1" })];
  const [row] = attributeSales({ messages, sales, launches: [{ massId: "mm1", userId: "ana", name: "Ana" }] });
  assert.deepEqual([row?.chatterId, row?.chatterName, row?.rule, row?.kind], ["ana", "Ana", "mass", "mass"]);
  const [unknown] = attributeSales({ messages, sales, launches: [] });
  assert.deepEqual([unknown?.chatterId, unknown?.chatterName, unknown?.rule], [null, null, "none"]);
});

test("propinas y suscripciones: el último chatter que habló con ese fan; un masivo no cuenta como conversación", () => {
  const messages = [
    msg({ key: "a", at: "2026-11-03T09:00:00.000Z", authorId: "ana", authorName: NAMES.ana }),
    msg({ key: "b", at: "2026-11-03T10:00:00.000Z", authorId: "beto", authorName: NAMES.beto }),
    msg({ key: "m", at: "2026-11-03T10:30:00.000Z", authorId: "ana", authorName: NAMES.ana, massId: "mm1" }),
    msg({ key: "otro", at: "2026-11-03T10:45:00.000Z", authorId: "ana", authorName: NAMES.ana, fanKey: "99", threadKey: "99" }),
    msg({ key: "tarde", at: "2026-11-03T13:00:00.000Z", authorId: "ana", authorName: NAMES.ana }),
  ];
  const rows = attributeSales({
    messages,
    sales: [
      sale({ key: "tx:tip", at: "2026-11-03T11:00:00.000Z", kind: "tip", grossCents: 800 }),
      sale({ key: "tx:sub", at: "2026-11-03T12:00:00.000Z", kind: "subscription", grossCents: 1000 }),
      sale({ key: "tx:ren", at: "2026-11-03T14:00:00.000Z", kind: "renewal", grossCents: 1000 }),
    ],
  });
  assert.deepEqual(rows.map((row) => [row.saleKey, row.chatterId, row.rule]), [
    ["tx:tip", "beto", "last_chatter"],
    ["tx:sub", "beto", "last_chatter"],
    ["tx:ren", "ana", "last_chatter"],
  ]);
});

test("mensajes sin chatter: la venta queda sin nombre y no se inventa a nadie", () => {
  const rows = attributeSales({
    messages: [
      msg({ key: "p1", at: "2026-11-03T10:00:00.000Z", authorId: null, priceCents: 900, purchased: true }),
      msg({ key: "fan", at: "2026-11-03T09:00:00.000Z", authorId: null, fromFan: true }),
    ],
    sales: [
      sale({ key: "ppv:alba:p1", at: "2026-11-03T11:00:00.000Z", kind: "ppv", grossCents: 900, messageKey: "p1" }),
      sale({ key: "tx:tip", at: "2026-11-03T11:00:00.000Z", kind: "tip", grossCents: 500 }),
    ],
  });
  for (const row of rows) assert.deepEqual([row.chatterId, row.chatterName, row.rule], [null, null, "none"]);
  assert.deepEqual(chatterReports({ messages: [], sales: [] }), []);
});

test("las cifras por chatter suman lo atribuido, también a quien solo lanzó masivos", () => {
  const messages = [msg({ key: "p1", at: "2026-11-03T10:00:00.000Z", authorId: "ana", priceCents: 1500, purchased: true })];
  const sales = [
    sale({ key: "ppv:alba:p1", at: "2026-11-03T11:00:00.000Z", kind: "ppv", grossCents: 1500, messageKey: "p1" }),
    sale({ key: "tx:tip", at: "2026-11-03T12:00:00.000Z", kind: "tip", grossCents: 500 }),
    sale({ key: "ppv:alba:mass", at: "2026-11-03T12:00:00.000Z", kind: "ppv", grossCents: 2000, messageKey: "mass", fanKey: "8" }),
  ];
  const withMass = [...messages, msg({ key: "mass", at: "2026-11-03T11:30:00.000Z", authorId: null, fanKey: "8", threadKey: "8", priceCents: 2000, purchased: true, massId: "mm1" })];
  const reports = chatterReports({ messages: withMass, sales, launches: [{ massId: "mm1", userId: "beto", name: "Beto" }] });
  const gross = Object.fromEntries(reports.map((report) => [report.userId, report.grossCents]));
  assert.deepEqual(gross, { ana: 2000, beto: 2000 });
});

test("persistida: se escribe una vez, no se reasigna y conserva el nombre si borran a la persona", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-attr-"));
  const pg = new PGlite(dir);
  try {
    await pg.exec(await readFile(path.join(root, "migrations", "0066_sale_attribution.sql"), "utf8"));
    await pg.exec(await readFile(path.join(root, "migrations", "0027_mass_messages.sql"), "utf8"));
    const sql = { query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows };
    const base = { creatorId: "alba", fanKey: "7", kind: "tip" as const, at: "2026-11-03T11:00:00.000Z", grossCents: 800 };
    await persistAttributions(sql, [{ ...base, saleKey: "tx:1", chatterId: "ana", chatterName: "Ana", rule: "last_chatter" }]);
    // Más tarde el cálculo daría a otra persona: lo guardado manda.
    await persistAttributions(sql, [{ ...base, saleKey: "tx:1", chatterId: "beto", chatterName: "Beto", rule: "last_chatter" }]);
    // Una venta sin chatter se completa cuando aparece quién fue.
    await persistAttributions(sql, [{ ...base, saleKey: "tx:2", chatterId: null, chatterName: null, rule: "none" }]);
    await persistAttributions(sql, [{ ...base, saleKey: "tx:2", chatterId: "beto", chatterName: "Beto", rule: "last_chatter" }]);
    const rows = await readAttributions(sql, ["alba"]);
    assert.deepEqual(rows.map((row) => [row.saleKey, row.chatterId, row.chatterName, row.rule, row.grossCents]), [
      ["tx:1", "ana", "Ana", "last_chatter", 800],
      ["tx:2", "beto", "Beto", "last_chatter", 800],
    ]);
    assert.deepEqual(await readAttributions(sql, ["otra"]), []);
    assert.equal((await readAttributions(sql)).length, 2);

    await pg.exec("insert into of_mass_message (id, creator_id, idempotency_key, name, body, body_json, segment_json, created_by_id, created_by_name) values ('mm1', 'alba', 'k', 'n', 'b', '{}', '{}', 'ana', 'Ana')");
    assert.deepEqual(await readMassLaunches(sql), [{ massId: "mm1", userId: "ana", name: "Ana" }]);
  } finally {
    await pg.close();
  }
});
