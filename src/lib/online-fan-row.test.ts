import assert from "node:assert/strict";
import { test } from "node:test";
import { fanInitials, filterOnlineFans, onlineCapPhrase, onlineListNames, spendLabel } from "./online-fan-row.ts";

test("el gasto ausente no se presenta como cero y el filtro no suma dinero", () => {
  assert.equal(spendLabel(null), "Sin datos");
  assert.equal(spendLabel(0), "$0.00");
  assert.equal(spendLabel(960), "$9.60");
  assert.equal(spendLabel(0, "EUR"), "0 €");
  assert.equal(spendLabel(480, "EUR"), "4.80 €");
  assert.equal(onlineCapPhrase(101, 100), "Vas a escribir a 100 fans en línea. El tope es 100.");
  const fans = [
    { fanKey: "1", lists: ["VIP"], spentCents: 960 },
    { fanKey: "2", lists: ["Nuevos"], spentCents: null },
  ];
  assert.deepEqual(onlineListNames(fans), ["VIP", "Nuevos"]);
  assert.deepEqual(filterOnlineFans(fans, "Todos").map((fan) => fan.fanKey), ["1", "2"]);
  assert.deepEqual(filterOnlineFans(fans, "VIP").map((fan) => fan.fanKey), ["1"]);
  assert.equal(fanInitials("Didi Luna", null), "DL");
  assert.equal(fanInitials(null, "@alejandrogym"), "AL");
});
