import assert from "node:assert/strict";
import { test } from "node:test";
import { filterGallery, galleryCounts, galleryItems, type GalleryMessage } from "./chat-gallery.ts";

const messages: GalleryMessage[] = [
  { messageKey: "m1", sentAt: "2026-11-01T10:00:00Z", priceCents: null, media: [{ kind: "foto", preview: "a.jpg" }, { kind: "video", seconds: 12, preview: "b.jpg" }] },
  { messageKey: "m2", sentAt: "2026-11-03T10:00:00Z", priceCents: 1500, media: [{ kind: "video", seconds: 40, preview: "c.jpg", locked: true }] },
  { messageKey: "m3", sentAt: "2026-11-02T10:00:00Z", priceCents: null, media: null },
  { messageKey: "m4", sentAt: "2026-11-04T10:00:00Z", fromFan: true, priceCents: null, mediaPreview: "d.jpg", media: [] },
  { messageKey: "m5", sentAt: "2026-11-05T10:00:00Z", priceCents: 0, media: [{ kind: "foto", preview: "e.jpg", priceCents: 500 }] },
];

test("la galería junta todos los medios, del más nuevo al más viejo, sin inventar los que no hay", () => {
  const items = galleryItems(messages);
  assert.deepEqual(items.map((item) => item.messageKey), ["m5", "m4", "m2", "m1", "m1"]);
  assert.equal(items.find((item) => item.messageKey === "m4")?.fromFan, true);
  assert.equal(items.find((item) => item.messageKey === "m3"), undefined);
  assert.deepEqual(galleryItems([]), []);
});

test("de pago es lo que tiene precio, en el mensaje o en el medio", () => {
  const items = galleryItems(messages);
  assert.deepEqual(items.filter((item) => item.paid).map((item) => item.messageKey), ["m5", "m2"]);
  assert.equal(filterGallery(items, { kind: "todos", pay: "gratis" }).length, 3);
});

test("los filtros de foto, vídeo y pago se combinan", () => {
  const items = galleryItems(messages);
  assert.equal(filterGallery(items, { kind: "foto", pay: "todos" }).length, 2);
  assert.equal(filterGallery(items, { kind: "video", pay: "todos" }).length, 2);
  assert.deepEqual(filterGallery(items, { kind: "video", pay: "pagado" }).map((item) => item.messageKey), ["m2"]);
  assert.equal(filterGallery(items, { kind: "foto", pay: "pagado" }).length, 1);
  assert.deepEqual(galleryCounts(items), { total: 5, fotos: 2, videos: 2, pagados: 2, gratis: 3 });
});
