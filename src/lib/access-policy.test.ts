import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertWorkspaceChange,
  canOperateCreator,
  emptyWorkspace,
  WorkspaceAccessError,
  type TeamAccess,
  type WorkspaceSlice,
} from "./access-policy.ts";
import { isLoopbackHost } from "./loopback.ts";

const owner: TeamAccess = { userId: "owner", role: "owner", perms: [], creatorIds: [] };
const chatter: TeamAccess = { userId: "chatter", role: "member", perms: ["mensajes"], creatorIds: ["c-alba"] };

function withCreator(base: WorkspaceSlice, id: string): WorkspaceSlice {
  return { ...base, creators: [...base.creators, { id, creatorId: id }] };
}

test("el modo local solo reconoce el loopback", () => {
  assert.equal(isLoopbackHost("localhost:8081"), true);
  assert.equal(isLoopbackHost("[::1]:8081"), true);
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("fanlink.example:8081"), false);
});

test("la dueña puede cambiar el workspace y un miembro no añade creadoras", () => {
  const prev = emptyWorkspace();
  const next = withCreator(prev, "c-alba");
  assert.doesNotThrow(() => assertWorkspaceChange(owner, prev, next));
  assert.throws(() => assertWorkspaceChange(chatter, prev, next), WorkspaceAccessError);
});

test("un miembro solo toca fans de las creadoras asignadas", () => {
  const prev = withCreator(emptyWorkspace(), "c-alba");
  const ownFan = { ...prev, fans: [{ id: "f1", creatorId: "c-alba", notes: "" }] };
  const edited = { ...ownFan, fans: [{ id: "f1", creatorId: "c-alba", notes: "hola" }] };
  assert.doesNotThrow(() => assertWorkspaceChange(chatter, ownFan, edited));
  const other = { ...prev, fans: [{ id: "f2", creatorId: "c-otra", notes: "" }] };
  assert.throws(() => assertWorkspaceChange(chatter, prev, other), /esa creadora/);
  assert.equal(canOperateCreator(chatter, "c-alba", "mensajes"), true);
  assert.equal(canOperateCreator(chatter, "c-otra", "mensajes"), false);
  assert.equal(canOperateCreator(chatter, "c-alba", "equipo"), false);
  assert.equal(canOperateCreator(owner, "c-otra", "equipo"), true);
});

test("un miembro no cambia el equipo", () => {
  const prev = emptyWorkspace();
  const next = { ...prev, employees: [{ id: "e-1" }] };
  assert.throws(() => assertWorkspaceChange(chatter, prev, next), /dueña/);
});
