import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { spendTone } from "./spend-tiers.ts";
import { rowSpendCents } from "./row-spend.ts";

const dom = new Window({ url: "https://fanlink.test/mensajes" });
Object.assign(globalThis, {
  window: dom,
  document: dom.document,
  HTMLElement: dom.HTMLElement,
  Node: dom.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});

test("la fila usa hilo, luego ficha, luego lo pedido", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await show(root, 0, 150, null);
    assert.equal(document.getElementById("spend")?.textContent, "$0.00");
    await show(root, null, 150, 0);
    assert.equal(document.getElementById("spend")?.textContent, "$1.50");
    await show(root, null, null, 0);
    assert.equal(document.getElementById("spend")?.textContent, "$0.00");
    await show(root, null, null, null);
    assert.equal(document.getElementById("spend")?.textContent, "Sin datos");
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});

function SpendRow(props: { thread: number | null; card: number | null; fetched: number | null }) {
  const cents = rowSpendCents(props.thread, props.card, props.fetched);
  const tone = spendTone(cents);
  return createElement("span", { id: "spend" }, tone.label);
}

async function show(root: ReturnType<typeof createRoot>, thread: number | null, card: number | null, fetched: number | null) {
  await act(async () => {
    root.render(createElement(SpendRow, { thread, card, fetched }));
  });
}
