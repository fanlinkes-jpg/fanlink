import assert from "node:assert/strict";
import test from "node:test";
import { vaultSentPill, vaultUsageText } from "./vault-usage.ts";

test("el historial dice Sin datos en lo que OnlyFans no manda y no usa las compras", () => {
  assert.equal(
    vaultUsageText({
      posted: true,
      sent: true,
      sentCount: 3,
      priceLabel: "$5.00",
      dateLabel: "2 ene 26",
      seconds: 12,
      kind: "video",
    }),
    "Feed Publicado · Envíos Enviado 3 · Precio $5.00 · Fecha 2 ene 26 · Duración 0:12",
  );
  assert.equal(
    vaultUsageText({
      posted: null,
      sent: null,
      sentCount: null,
      priceLabel: null,
      dateLabel: null,
      seconds: null,
      kind: "video",
    }),
    "Feed Sin datos · Envíos Sin datos · Precio Sin datos · Fecha Sin datos · Duración Sin datos",
  );
  assert.equal(
    vaultUsageText({
      posted: false,
      sent: false,
      sentCount: null,
      priceLabel: "Free",
      dateLabel: "2 ene 26",
      seconds: null,
      kind: "foto",
    }),
    "Feed No publicado · Envíos No enviado · Precio Free · Fecha 2 ene 26",
  );
  assert.equal(vaultSentPill(true, 3), "Enviado 3");
  assert.equal(vaultSentPill(true, null), "Enviado");
  assert.equal(vaultSentPill(null, null), null);
  assert.equal(vaultSentPill(null, 2), "Enviado 2");
  assert.equal(vaultSentPill(false, null), null);
});
