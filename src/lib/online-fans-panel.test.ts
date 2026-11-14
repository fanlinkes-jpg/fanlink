import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import type { OnlineFansPanel as OnlineFansPanelComponent } from "../features/online-fans-panel.tsx";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");

const root = path.resolve(import.meta.dirname, "../..");
const longName = "Nombre larguísimo que no debe empujar el bocadillo fuera del panel";

test("el bocadillo de cada fan conserva su columna y el nombre se trunca", async () => {
  const Panel = await loadPanel();
  const html = renderToStaticMarkup(createElement(Panel, {
    busy: false,
    note: null,
    fans: [{
      fanKey: "fan-1",
      fanName: longName,
      fanHandle: "fanlargo",
      avatarUrl: null,
      spentCents: 960,
      currency: "USD",
      online: true,
      lists: ["VIP"],
    }],
    sendEnabled: false,
    sendReason: "Envío a todos desactivado",
    cap: 100,
    onRefresh() {},
    onOpenChat() {},
    async onSend() {
      throw new Error("el envío a todos sigue apagado");
    },
    onCancel() {},
  }));

  const document = new Window().document;
  document.body.innerHTML = html;
  const panel = document.body.firstElementChild;
  assert.ok(panel);
  assert.match(classes(panel), /(^|\s)w-\[20rem\](\s|$)/);
  assert.match(classes(panel), /(^|\s)max-w-\[calc\(100vw-2\.5rem\)\](\s|$)/);
  assert.match(classes(panel), /(^|\s)overflow-hidden(\s|$)/);
  assert.doesNotMatch(classes(panel), /(^|\s)w-\[22rem\](\s|$)/);

  const button = document.querySelector("button[aria-label='Abrir chat de " + longName + "']");
  assert.ok(button);
  assert.match(classes(button), /\bshrink-0\b/);
  const actions = button.parentElement;
  assert.ok(actions);
  assert.match(classes(actions), /\bshrink-0\b/);
  assert.equal(actions.querySelector("svg"), button.querySelector("svg"));

  const row = actions.parentElement;
  assert.ok(row);
  assert.match(classes(row), /\bpr-4\b/);
  assert.match(classes(row), /\boverflow-hidden\b/);
  assert.match(classes(row), /\bmin-w-0\b/);

  const name = [...row.querySelectorAll("span")].find((node) => node.textContent === longName);
  assert.ok(name);
  assert.match(classes(name), /\bmin-w-0\b/);
  assert.match(classes(name), /\btruncate\b/);

  const scroller = row.parentElement;
  assert.ok(scroller);
  assert.match(classes(scroller), /\boverflow-x-hidden\b/);
  assert.match(classes(scroller), /\boverflow-y-auto\b/);

  assert.equal(document.body.textContent?.includes("$9.60"), true);
  assert.equal(document.body.textContent?.includes("Envío a todos desactivado"), true);
  assert.equal(document.querySelector("textarea"), null);
});

function classes(node: { getAttribute(name: string): string | null }): string {
  return node.getAttribute("class") ?? "";
}

// node:test no transforma JSX: se transpila el panel y se renderiza de verdad.
async function loadPanel(): Promise<typeof OnlineFansPanelComponent> {
  const sourcePath = path.join(root, "src/features/online-fans-panel.tsx");
  const rowUrl = pathToFileURL(path.join(root, "src/lib/online-fan-row.ts")).href;
  const transpiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    fileName: sourcePath,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText.replace(
    /from\s+["']@\/lib\/online-fan-row["']/,
    `from ${JSON.stringify(rowUrl)}`,
  );
  const cache = path.join(root, "node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(path.join(cache, "online-fans-panel-"));
  const file = path.join(dir, "panel.mjs");
  writeFileSync(file, transpiled);
  try {
    const loaded = await import(pathToFileURL(file).href) as { OnlineFansPanel: typeof OnlineFansPanelComponent };
    return loaded.OnlineFansPanel;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
