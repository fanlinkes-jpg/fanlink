import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { FanSpendLabel } from "./fan-spend-label.ts";

const dom = new Window({ url: "https://fanlink.test/mensajes" });
Object.assign(globalThis, {
  window: dom,
  document: dom.document,
  HTMLElement: dom.HTMLElement,
  Node: dom.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});

test("la fila real usa hilo, luego ficha, luego lo pedido", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await show(root, 0, 150, null);
    assert.equal(host.textContent, "$0.00");
    await show(root, null, 150, 0);
    assert.equal(host.textContent, "$1.50");
    await show(root, null, null, 0);
    assert.equal(host.textContent, "$0.00");
    await show(root, null, null, null);
    assert.equal(host.textContent, "Sin datos");
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});

async function show(root: ReturnType<typeof createRoot>, thread: number | null, card: number | null, fetched: number | null) {
  await act(async () => {
    root.render(createElement(FanSpendLabel, { thread, card, fetched }));
  });
}
