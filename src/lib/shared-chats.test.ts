import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canOperateCreator,
  canSeeAgencyEarnings,
  canSeeChatterFigures,
  creatorIdsForChats,
  type TeamAccess,
} from "./access-policy.ts";

const chatter: TeamAccess = { userId: "chatter", role: "member", perms: ["mensajes"], creatorIds: ["c-alba"] };
const other: TeamAccess = { userId: "otro", role: "member", perms: ["mensajes"], creatorIds: ["c-alba"] };
const owner: TeamAccess = { userId: "owner", role: "owner", perms: [], creatorIds: [] };

test("un chatter solo ve los chats de las cuentas asignadas y la dueña todos", () => {
  assert.deepEqual(creatorIdsForChats(chatter, ["c-alba", "c-otra"]), ["c-alba"]);
  assert.deepEqual(creatorIdsForChats(owner, ["c-alba", "c-otra"]), ["c-alba", "c-otra"]);
  assert.deepEqual(creatorIdsForChats(null, ["c-alba"]), []);
  assert.equal(canOperateCreator(chatter, "c-alba", "mensajes"), true);
  assert.equal(canOperateCreator(chatter, "c-otra", "mensajes"), false);
  assert.equal(canOperateCreator(chatter, "c-alba", "equipo"), false);
});

test("un chatter no ve ingresos de la agencia ni las cifras de otro", () => {
  assert.equal(canSeeAgencyEarnings(chatter), false);
  assert.equal(canSeeAgencyEarnings(owner), true);
  assert.equal(canSeeChatterFigures(chatter, "chatter"), true);
  assert.equal(canSeeChatterFigures(chatter, "otro"), false);
  assert.equal(canSeeChatterFigures(other, "chatter"), false);
  assert.equal(canSeeChatterFigures(owner, "otro"), true);
});
