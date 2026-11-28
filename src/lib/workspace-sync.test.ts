import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyWorkspace, type WorkspaceSlice } from "./access-policy.ts";
import { conflictNotice, createWorkspaceSaver, mergeWorkspaceFields, type WorkspaceSaveOutcome } from "./workspace-sync.ts";

function slice(patch: Partial<WorkspaceSlice>): WorkspaceSlice {
  return { ...emptyWorkspace(), ...patch };
}

test("dos campos distintos se quedan los dos y el mismo usuario no ve el aviso", () => {
  const base = slice({ agency: "Uno", copilot: true });
  const local = slice({ agency: "Dos", copilot: true });
  const remote = slice({ agency: "Uno", copilot: false });
  const merged = mergeWorkspaceFields(base, local, remote, true);
  assert.equal(merged.agency, "Dos");
  assert.equal(merged.copilot, false);
  assert.equal(conflictNotice("ana", "ana"), null);
  assert.equal(conflictNotice("otro", "ana"), "Otra sesión guardó antes. Se muestra la copia del servidor.");
  const kept = mergeWorkspaceFields(base, local, remote, false);
  assert.equal(kept.agency, "Dos");
  assert.equal(kept.copilot, false);
  const both = mergeWorkspaceFields(base, local, slice({ agency: "Tres", copilot: false }), false);
  assert.equal(both.agency, "Tres");
  assert.equal(both.copilot, false);
});

test("un solo guardado vuela y el siguiente usa la versión que devolvió", async () => {
  const calls: number[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: string[] = [];
  const saver = createWorkspaceSaver({
    save: async (input): Promise<WorkspaceSaveOutcome> => {
      calls.push(input.expectedVersion);
      if (calls.length === 1) await gate;
      if (input.expectedVersion === 0 && calls.length > 1) {
        return { ok: false, reason: "conflict", version: 1, state: slice({ agency: "servidor" }), updatedBy: "ana" };
      }
      seen.push(input.state.agency);
      return { ok: true, version: input.expectedVersion + 1 };
    },
    userId: () => "ana",
    apply: () => undefined,
    notice: () => undefined,
    forbid: () => undefined,
  });
  saver.push(slice({ agency: "primera" }));
  saver.push(slice({ agency: "segunda" }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, [0]);
  release();
  await saver.idle();
  assert.deepEqual(calls, [0, 1]);
  assert.deepEqual(seen, ["primera", "segunda"]);
});
