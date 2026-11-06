import assert from "node:assert/strict";
import { test } from "node:test";
import { alertMode, targetsForCreator, type AlertPerson } from "./audience.ts";

const people: AlertPerson[] = [
  { userId: "asignada", phone: "+34600000001", enabled: true, quietMinutes: 15, creatorIds: ["c-alba"] },
  { userId: "libre", phone: "+34600000002", enabled: true, quietMinutes: 15, creatorIds: [] },
];

test("por defecto el aviso llega a todos los chatters activos", () => {
  assert.equal(alertMode(undefined), "all");
  const targets = targetsForCreator(people, "c-otra", "all", []);
  assert.deepEqual(targets.map((item) => item.userId).sort(), ["asignada", "libre"]);
});

test("el modo assigned solo avisa a quien tiene la cuenta", () => {
  const targets = targetsForCreator(people, "c-alba", "assigned", []);
  assert.deepEqual(targets.map((item) => item.userId), ["asignada"]);
});
