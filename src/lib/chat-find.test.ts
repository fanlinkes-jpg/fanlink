import assert from "node:assert/strict";
import { test } from "node:test";
import { findMessages, foldText, highlightParts, stepMatch } from "./chat-find.ts";

const messages = [
  { messageKey: "m2", sentAt: "2026-11-02T10:00:00Z", body: "Gracias por la sesión de ayer" },
  { messageKey: "m1", sentAt: "2026-11-01T10:00:00Z", body: "hola guapo" },
  { messageKey: "m3", sentAt: "2026-11-03T10:00:00Z", body: "SESION nueva mañana" },
  { messageKey: "m4", sentAt: "2026-11-04T10:00:00Z", body: "" },
];

test("encuentra sin importar mayúsculas ni acentos y en orden de conversación", () => {
  assert.equal(foldText("Sesión"), "sesion");
  assert.deepEqual(findMessages(messages, "sesion"), ["m2", "m3"]);
  assert.deepEqual(findMessages(messages, " SESIÓN "), ["m2", "m3"]);
});

test("no busca con menos de dos letras ni devuelve mensajes vacíos", () => {
  assert.deepEqual(findMessages(messages, "s"), []);
  assert.deepEqual(findMessages(messages, ""), []);
  assert.deepEqual(findMessages(messages, "zzz"), []);
});

test("siguiente y anterior dan la vuelta", () => {
  assert.equal(stepMatch(1, 2, 1), 0);
  assert.equal(stepMatch(0, 2, -1), 1);
  assert.equal(stepMatch(0, 0, 1), 0);
});

test("marca el texto encontrado conservando el original", () => {
  assert.deepEqual(highlightParts("Gracias por la Sesión", "sesion"), [
    { text: "Gracias por la ", hit: false },
    { text: "Sesión", hit: true },
  ]);
  assert.deepEqual(highlightParts("hola", "x"), [{ text: "hola", hit: false }]);
  assert.equal(highlightParts("sí sí", "si").filter((part) => part.hit).length, 2);
});
