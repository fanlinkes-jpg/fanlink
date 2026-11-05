import assert from "node:assert/strict";
import { test } from "node:test";
import { planAlerts } from "../notify/plan.ts";
import { createWhatsAppSender, normalizePhone } from "../notify/whatsapp.ts";

const NOW = new Date("2026-11-05T12:00:00.000Z");

test("sin credenciales el aviso solo se simula", async () => {
  let called = false;
  const send = createWhatsAppSender(
    { FANLINK_WHATSAPP_PROVIDER: "twilio" },
    async () => {
      called = true;
      return new Response("no", { status: 500 });
    },
  );
  const result = await send({ to: "+34600000000", body: "OnlyFans · Alba\nFan Uno: Hola" });
  assert.equal(result.simulated, true);
  assert.equal(result.provider, "simulated");
  assert.equal(called, false);
  assert.equal(normalizePhone(" +34 600 000 000 "), "+34600000000");
  assert.equal(normalizePhone("600000000"), null);
});

test("agrupa avisos del mismo chatter y no repite un fan reciente", () => {
  const events = [
    { id: "1", creatorId: "c-alba", creatorName: "Alba", fanKey: "7", fanName: "Fan Uno", excerpt: "Hola", sentAt: NOW.toISOString() },
    { id: "2", creatorId: "c-alba", creatorName: "Alba", fanKey: "8", fanName: "Fan Dos", excerpt: "Precio", sentAt: NOW.toISOString() },
    { id: "3", creatorId: "c-alba", creatorName: "Alba", fanKey: "7", fanName: "Fan Uno", excerpt: "Otra vez", sentAt: NOW.toISOString() },
  ];
  const targets = new Map([
    [
      "c-alba",
      [
        { userId: "chatter", phone: "+34600000000", enabled: true, quietMinutes: 15 },
        { userId: "off", phone: "+34600000001", enabled: false, quietMinutes: 15 },
        { userId: "empty", phone: null, enabled: true, quietMinutes: 15 },
      ],
    ],
  ]);
  const planned = planAlerts({ events, targetsByCreator: targets, recent: [], now: NOW });
  assert.equal(planned.length, 1);
  assert.equal(planned[0]?.fanKeys.join(","), "7,8");
  assert.match(planned[0]?.body ?? "", /OnlyFans · Alba/);
  assert.match(planned[0]?.body ?? "", /Fan Uno: Hola/);
  assert.match(planned[0]?.body ?? "", /Fan Dos: Precio/);

  const quiet = planAlerts({
    events: [events[0]!],
    targetsByCreator: targets,
    recent: [{ userId: "chatter", creatorId: "c-alba", fanKey: "7", sentAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() }],
    now: NOW,
  });
  assert.equal(quiet.length, 0);
});
