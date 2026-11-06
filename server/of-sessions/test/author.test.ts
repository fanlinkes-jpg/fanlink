import assert from "node:assert/strict";
import { test } from "node:test";
import { matchOutboundAuthor } from "../sync/author-match.ts";
import { presentTeamMetrics } from "../metrics/present-team.ts";
import type { TeamAccess } from "../../../src/lib/access-policy.ts";

const chatter: TeamAccess = { userId: "e-1", role: "member", perms: ["mensajes"], creatorIds: ["c-alba"] };
const other: TeamAccess = { userId: "e-2", role: "member", perms: ["mensajes"], creatorIds: ["c-otra"] };
const owner: TeamAccess = { userId: "owner", role: "owner", perms: [], creatorIds: [] };

test("el mensaje sincronizado hereda al chatter que lo escribió en el CRM", () => {
  const match = matchOutboundAuthor(
    {
      messageKey: "m-9",
      threadKey: "fan-7",
      fanKey: "fan-7",
      body: "<p>Hola</p>",
      sentAt: "2026-11-06T10:05:00.000Z",
      priceCents: 500,
    },
    [
      {
        id: "out-1",
        authorId: "e-1",
        body: "Hola",
        priceCents: 500,
        createdAt: "2026-11-06T10:04:00.000Z",
        threadKey: "local",
        fanKey: "local",
        ofMessageKey: null,
      },
    ],
  );
  assert.equal(match?.authorId, "e-1");
  const byId = matchOutboundAuthor(
    {
      messageKey: "of-1",
      threadKey: "fan-7",
      fanKey: "fan-7",
      body: "otro",
      sentAt: "2026-11-06T10:05:00.000Z",
      priceCents: null,
    },
    [
      {
        id: "out-2",
        authorId: "e-2",
        body: "distinto",
        priceCents: null,
        createdAt: "2026-11-06T10:04:00.000Z",
        threadKey: null,
        fanKey: null,
        ofMessageKey: "of-1",
      },
    ],
  );
  assert.equal(byId?.authorId, "e-2");
});

test("un chatter ve su cifra y no la de otro ni un total de creadora", () => {
  const messages = [
    {
      creatorId: "c-alba",
      threadKey: "7",
      fanKey: "7",
      at: "2026-11-06T10:00:00.000Z",
      fromFan: false,
      priceCents: 500,
      purchased: true,
      authorId: "e-1",
    },
    {
      creatorId: "c-otra",
      threadKey: "8",
      fanKey: "8",
      at: "2026-11-06T10:00:00.000Z",
      fromFan: false,
      priceCents: 900,
      purchased: true,
      authorId: "e-2",
    },
  ];
  const sales = [
    { creatorId: "c-alba", fanKey: "7", at: "2026-11-06T10:06:00.000Z", grossCents: 500, kind: "ppv" as const },
    { creatorId: "c-otra", fanKey: "8", at: "2026-11-06T10:06:00.000Z", grossCents: 900, kind: "ppv" as const },
  ];
  const names = new Map([["e-1", "Ana"], ["e-2", "Luis"]]);
  const own = presentTeamMetrics(chatter, messages, sales, names);
  assert.equal(own.length, 1);
  assert.equal(own[0]?.userId, "e-1");
  assert.equal(own[0]?.name, "Ana");
  assert.equal(own[0]?.grossCents, 500);
  assert.equal(own.some((row) => row.userId === "e-2"), false);
  const hidden = presentTeamMetrics({ ...other, perms: [] }, messages, sales, names);
  assert.equal(hidden.length, 0);
  const all = presentTeamMetrics(owner, messages, sales, names);
  assert.equal(all.length, 2);
  assert.equal(all.find((row) => row.userId === "e-2")?.grossCents, 900);
});
