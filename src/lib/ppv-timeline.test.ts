import assert from "node:assert/strict";
import { test } from "node:test";
import { PPV_MEDIA_MAX, clipLabel, mediaItems, mergePpvSources, ppvDateLabel, ppvTimeline } from "./ppv-timeline.ts";

test("el buy rate y la línea de PPV solo usan precios y compras reales", () => {
  const empty = ppvTimeline([
    { messageKey: "a", body: "hola", sentAt: "2026-11-06T10:00:00.000Z", fromFan: false, priceCents: null, purchased: null },
    { messageKey: "b", body: "fan", sentAt: "2026-11-06T11:00:00.000Z", fromFan: true, priceCents: 500, purchased: true },
  ]);
  assert.equal(empty.rate, "Sin datos");
  assert.equal(empty.high, "Sin datos");
  assert.equal(empty.rows.length, 0);
  const filled = ppvTimeline([
    { messageKey: "1", body: "set caro", sentAt: "2026-11-06T12:00:00.000Z", fromFan: false, priceCents: 1500, purchased: true, mediaCount: 2, mediaSeconds: 15, mediaPreview: "https://cdn.example/a.jpg" },
    { messageKey: "2", body: "set", sentAt: "2026-11-06T09:00:00.000Z", fromFan: false, priceCents: 500, purchased: false, mediaCount: null },
    { messageKey: "3", body: "duda", sentAt: "2026-11-06T08:00:00.000Z", fromFan: false, priceCents: 800, purchased: null },
  ]);
  assert.equal(filled.rate, "1/2 (50%)");
  assert.equal(filled.high, "$15.00");
  assert.equal(filled.low, "$5.00");
  assert.equal(filled.rows[0]?.state, "comprado");
  assert.equal(filled.rows[0]?.media, "2 medios · 15s");
  assert.equal(filled.rows[0]?.preview, "https://cdn.example/a.jpg");
  assert.equal(filled.rows[1]?.state, "no comprado");
  assert.equal(filled.rows[2]?.state, "Sin datos");
  assert.equal(filled.rows[2]?.media, "Sin datos");
});

test("caso Maik: compras guardadas dan el buy rate del hilo completo y el precio más alto", () => {
  const sent = (key: string, day: string, cents: number, purchased: boolean | null = null) => (
    { messageKey: key, body: key, sentAt: `2026-11-${day}T10:00:00.000Z`, fromFan: false, priceCents: cents, purchased }
  );
  const all = [
    ...Array.from({ length: 15 }, (_, i) => sent(`m${i}`, String(i + 1).padStart(2, "0"), 1199 + i)),
    sent("caro", "20", 6900),
    sent("pagado", "21", 2499),
  ];
  const withoutPurchases = ppvTimeline(all);
  assert.equal(withoutPurchases.rate, "Sin datos");
  const timeline = ppvTimeline(all, [{ sentAt: "2026-11-21T12:00:00.000Z", priceCents: 2499 }]);
  assert.equal(timeline.rows.length, 17);
  assert.equal(timeline.rate, "1/17 (6%)");
  assert.equal(timeline.high, "$69.00");
  assert.equal(timeline.low, "$11.99");
  assert.equal(timeline.rows.find((row) => row.messageKey === "pagado")?.state, "comprado");
  assert.equal(timeline.rows.find((row) => row.messageKey === "caro")?.state, "no comprado");
});

test("una compra ya marcada en el mensaje no se cuenta dos veces y una sin mensaje entra como fila", () => {
  const flagged = { messageKey: "a", body: "a", sentAt: "2026-11-05T10:00:00.000Z", fromFan: false, priceCents: 1000, purchased: true };
  const timeline = ppvTimeline([flagged], [
    { sentAt: "2026-11-05T10:00:00.000Z", priceCents: 1000 },
    { sentAt: "2026-11-07T10:00:00.000Z", priceCents: 1000 },
  ]);
  assert.equal(timeline.rows.length, 2);
  assert.equal(timeline.rate, "2/2 (100%)");
  assert.equal(timeline.rows.filter((row) => row.messageKey.startsWith("compra:")).length, 1);
});

test("mergePpvSources no repite mensajes y prefiere el cargado", () => {
  const loaded = [{ messageKey: "a", body: "nuevo", sentAt: "2026-11-05T10:00:00.000Z", fromFan: false, priceCents: 500, purchased: true }];
  const stored = [
    { messageKey: "a", body: "viejo", sentAt: "2026-11-05T10:00:00.000Z", fromFan: false, priceCents: 500, purchased: null },
    { messageKey: "b", body: "b", sentAt: "2026-11-01T10:00:00.000Z", fromFan: false, priceCents: 900, purchased: null },
  ];
  const merged = mergePpvSources(loaded, stored);
  assert.deepEqual(merged.map((row) => row.messageKey), ["a", "b"]);
  assert.equal(merged[0]?.body, "nuevo");
});

test("Maik: 23 PPV y una compra dan 1/23 (4%) y la fecha de la compra", () => {
  const own = Array.from({ length: 22 }, (_, i) => (
    { messageKey: `m${i}`, body: "x", sentAt: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`, fromFan: false, priceCents: 1299 + i, purchased: null as boolean | null }
  ));
  const bought = { messageKey: "pagado", body: "x", sentAt: "2026-10-14T10:00:00.000Z", fromFan: false, priceCents: 2499, purchased: true as boolean | null };
  const timeline = ppvTimeline([...own, bought], [{ sentAt: "2026-10-16T14:00:00.000Z", priceCents: 2499 }]);
  assert.equal(timeline.rows.length, 23);
  assert.equal(timeline.rate, "1/23 (4%)");
});

test("los medios del PPV salen todos, en orden, con duración y candado, y la fecha como Infloww", () => {
  const timeline = ppvTimeline([{
    messageKey: "a",
    body: "texto",
    sentAt: "2026-10-16T14:00:00.000Z",
    fromFan: false,
    priceCents: 1999,
    purchased: false,
    media: [
      { kind: "video", seconds: 12, preview: "https://cdn.example/1.jpg", locked: true },
      { kind: "foto", seconds: null, preview: "https://cdn.example/2.jpg", locked: true },
      { kind: "video", seconds: 3725, preview: null, locked: false },
    ],
  }]);
  const items = timeline.rows[0]?.items ?? [];
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((item) => clipLabel(item.seconds)), ["0:12", null, "1:02:05"]);
  assert.deepEqual(items.map((item) => item.locked), [true, true, false]);
  assert.equal(ppvDateLabel("2026-10-16T14:00:00.000Z"), "Oct 16, 2026");
  const many = mediaItems({ media: Array.from({ length: 40 }, () => ({ kind: "foto" as const, preview: "u" })) });
  assert.equal(many.length, PPV_MEDIA_MAX);
  assert.deepEqual(mediaItems({ mediaPreview: "https://x/p.jpg", mediaSeconds: 9 }), [{ kind: null, seconds: 9, preview: "https://x/p.jpg", locked: null }]);
  assert.deepEqual(mediaItems({}), []);
});
