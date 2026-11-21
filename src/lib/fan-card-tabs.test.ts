import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FAN_CARD_TABS } from "./fan-card-tabs.ts";

test("la ficha del fan conserva las pestañas Insights, Ventas y Notas", () => {
  assert.deepEqual([...FAN_CARD_TABS], ["Insights", "Ventas", "Notas"]);
  const card = readFileSync(new URL("../features/fan-insights.tsx", import.meta.url), "utf8");
  const chat = readFileSync(new URL("../features/real-chats.tsx", import.meta.url), "utf8");
  assert.match(card, /FAN_CARD_TABS\.map/);
  assert.match(card, /shrink-0/);
  assert.match(chat, /aria-label="Ficha del fan"/);
  assert.match(chat, /flex min-h-0 flex-1 flex-col/);
});
