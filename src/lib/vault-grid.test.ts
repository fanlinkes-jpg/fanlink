import assert from "node:assert/strict";
import test from "node:test";
import { VAULT_GRID_CLASS, vaultGridColumns } from "./vault-grid.ts";

test("la cuadrícula se queda entre 5 y 8 columnas", () => {
  for (const width of [320, 1440, 1499, 1500, 1699, 1700, 1899, 1900, 2560, 4000]) {
    const columns = vaultGridColumns(width);
    assert.ok(columns >= 5 && columns <= 8, `${width}px → ${columns}`);
  }
  assert.equal(vaultGridColumns(1440), 5);
  assert.equal(vaultGridColumns(1600), 6);
  assert.equal(vaultGridColumns(1800), 7);
  assert.equal(vaultGridColumns(1920), 8);
  assert.equal(vaultGridColumns(2560), 8);
  assert.match(VAULT_GRID_CLASS, /grid-cols-5/);
  assert.match(VAULT_GRID_CLASS, /min-\[1900px\]:grid-cols-8/);
  assert.equal(VAULT_GRID_CLASS.includes("minmax(168px"), false);
});
