import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseChatMessages } from "../sync/chats.ts";
import { isAfterTxCursor, parseEarningsJson, parseFansJson, parseTransactions } from "../sync/parse.ts";
import { unseenFanKeys } from "../sync/store.ts";
import { memberMayUseSegment } from "../campaigns/segment.ts";
import { chatterReports } from "../metrics/team.ts";
import { creatorReport } from "../../../src/lib/creator-metrics.ts";
import { fanProfiles } from "../../../src/lib/fan-metrics.ts";
import { bootTasks } from "../../../src/lib/boot-plan.ts";

const NOW = new Date("2026-11-05T18:00:00.000Z");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("los alias de un mismo importe no se suman", () => {
  const rows = parseEarningsJson(
    { list: [{ date: "2026-11-01", subscriptions: 4, subscription: 4, gross: 10, net: 8, total: 10 }] },
    NOW,
  );
  assert.equal(rows.find((row) => row.kind === "subscription")?.amountCents, 400);
  assert.equal(rows.find((row) => row.kind === "total")?.amountCents, 1000);
});

test("un movimiento antiguo no pone el mes en cero ni tapa el gráfico", () => {
  const report = creatorReport({
    now: NOW,
    period: "month",
    earningsSynced: true,
    fansSynced: false,
    transactions: [{ occurredAt: "2026-08-01T12:00:00.000Z", grossCents: 5000, netCents: 4000, kind: "tip" }],
    earnings: [{ day: "2026-11-02", kind: "tip", amountCents: 300 }],
    fans: [],
  });
  assert.equal(report.grossCents, 300);
  assert.equal(report.series.some((point) => point.grossCents === 300), true);
});

test("si falta el neto de un movimiento, el neto del periodo es null", () => {
  const report = creatorReport({
    now: NOW,
    period: "month",
    earningsSynced: true,
    fansSynced: false,
    transactions: [
      { occurredAt: "2026-11-02T12:00:00.000Z", grossCents: 1000, netCents: 800, kind: "tip" },
      { occurredAt: "2026-11-03T12:00:00.000Z", grossCents: 500, netCents: null, kind: "message" },
    ],
    earnings: [],
    fans: [],
  });
  assert.equal(report.netCents, null);
});

test("el día se corta en Europe/Madrid, no en UTC", () => {
  const report = creatorReport({
    now: new Date("2026-11-05T00:30:00.000Z"),
    period: "day",
    earningsSynced: false,
    fansSynced: false,
    transactions: [{ occurredAt: "2026-11-04T23:30:00.000Z", grossCents: 700, netCents: 700, kind: "tip" }],
    earnings: [],
    fans: [],
  });
  assert.equal(report.grossCents, 700);
});

test("se leen más de 200 fans y el que ya no sale queda expirado", () => {
  const list = Array.from({ length: 201 }, (_, index) => ({
    id: index + 1,
    username: `fan${index}`,
    subscribedOnData: { subscribedAt: "2026-10-01" },
  }));
  assert.equal(parseFansJson({ list }, NOW).length, 201);
  assert.deepEqual(unseenFanKeys(["fan0", "fantasma"], ["fan0"], true), ["fantasma"]);
  assert.deepEqual(unseenFanKeys(["fan0", "fantasma"], ["fan0"], false), []);
});

test("sin interacción conocida no hay LTV ni segmento inventado", () => {
  const [profile] = fanProfiles({
    now: NOW,
    ppvSynced: false,
    fans: [{
      fanKey: "7",
      name: "Fan",
      status: "active",
      subscribedAt: "2026-01-01T00:00:00.000Z",
      renewAuto: null,
      spentCents: null,
      lastInteractionAt: null,
    }],
    purchases: [],
    ppv: [],
  });
  assert.equal(profile?.ltvCents, null);
  assert.equal(profile?.spend30Cents, null);
  assert.deepEqual(profile?.segments, []);
});

test("la misma venta no se reparte entre dos chatters", () => {
  const reports = chatterReports({
    sales: [{ creatorId: "c-alba", fanKey: "7", at: "2026-11-03T15:00:00.000Z", grossCents: 800, kind: "tip" }],
    messages: [
      { creatorId: "c-alba", threadKey: "7", fanKey: "7", at: "2026-11-03T14:00:00.000Z", fromFan: false, priceCents: null, purchased: null, authorId: "a" },
      { creatorId: "c-alba", threadKey: "7", fanKey: "7", at: "2026-11-03T14:10:00.000Z", fromFan: false, priceCents: null, purchased: null, authorId: "b" },
    ],
  });
  assert.equal(reports.every((row) => row.grossCents == null), true);
});

test("la primera respuesta cuenta un turno, no cada mensaje del fan", () => {
  const [report] = chatterReports({
    sales: [],
    messages: [
      { creatorId: "c-alba", threadKey: "7", fanKey: "7", at: "2026-11-05T10:00:00.000Z", fromFan: true, priceCents: null, purchased: null, authorId: null },
      { creatorId: "c-alba", threadKey: "7", fanKey: "7", at: "2026-11-05T10:02:00.000Z", fromFan: true, priceCents: null, purchased: null, authorId: null },
      { creatorId: "c-alba", threadKey: "7", fanKey: "7", at: "2026-11-05T10:10:00.000Z", fromFan: false, priceCents: null, purchased: null, authorId: "a" },
    ],
  });
  assert.equal(report?.firstReplyMinutes, 10);
});

test("un chatter sin ventas propias no ve un cero", () => {
  const reports = chatterReports({
    sales: [{ creatorId: "c-alba", fanKey: "7", at: "2026-11-03T15:00:00.000Z", grossCents: 800, kind: "tip" }],
    messages: [
      { creatorId: "c-alba", threadKey: "7", fanKey: "7", at: "2026-11-03T14:00:00.000Z", fromFan: false, priceCents: null, purchased: null, authorId: "a" },
      { creatorId: "c-otra", threadKey: "9", fanKey: "9", at: "2026-11-03T14:00:00.000Z", fromFan: false, priceCents: null, purchased: null, authorId: "b" },
    ],
  });
  assert.equal(reports.find((row) => row.userId === "b")?.grossCents, null);
  assert.equal(reports.find((row) => row.userId === "a")?.grossCents, 800);
});

test("un PPV a precio 0 o solo abierto no cuenta como compra", () => {
  const messages = parseChatMessages(
    {
      list: [
        { id: 1, text: "gratis", createdAt: "2026-11-05T10:00:00.000Z", price: 0, isOpened: true, fromUser: { id: 7 } },
        { id: 2, text: "de pago", createdAt: "2026-11-05T10:01:00.000Z", price: 5, purchased: true, fromUser: { id: 42 } },
      ],
    },
    "t",
    "7",
  );
  assert.equal(messages.find((row) => row.messageKey === "1")?.purchased, null);
  assert.equal(messages.find((row) => row.messageKey === "1")?.priceCents, 0);
  const [report] = chatterReports({
    sales: [],
    messages: [
      { creatorId: "c-alba", threadKey: "7", fanKey: "7", at: "2026-11-05T10:00:00.000Z", fromFan: false, priceCents: 0, purchased: true, authorId: "a" },
      { creatorId: "c-alba", threadKey: "7", fanKey: "7", at: "2026-11-05T10:01:00.000Z", fromFan: false, priceCents: 500, purchased: null, authorId: "a" },
    ],
  });
  assert.equal(report?.ppvSent, 1);
  assert.equal(report?.ppvBought, 0);
});

test("el cursor incremental distingue dos movimientos a la misma hora", () => {
  const cursor = { at: "2026-11-03T15:00:00.000Z", key: "tx-a" };
  assert.equal(isAfterTxCursor({ occurredAt: cursor.at, txKey: "tx-a" }, cursor), false);
  assert.equal(isAfterTxCursor({ occurredAt: cursor.at, txKey: "tx-b" }, cursor), true);
  const found = parseTransactions(
    { data: { items: [{ id: "tx-b", createdAt: cursor.at, amount: 2, type: "tip" }] } },
    NOW,
  );
  assert.equal(found[0]?.txKey, "tx-b");
});

test("un miembro no consulta segmentos por gasto", () => {
  assert.equal(memberMayUseSegment("owner", "whale"), true);
  assert.equal(memberMayUseSegment("member", "whale"), false);
  assert.equal(memberMayUseSegment("member", "spent"), false);
  assert.equal(memberMayUseSegment("member", "active"), true);
});

test("postgres arranca el planificador y el compose no publica la base ni apaga el acceso", async () => {
  assert.equal(bootTasks("neon").includes("scheduler"), true);
  const compose = await readFile(path.join(root, "docker-compose.yml"), "utf8");
  const docker = await readFile(path.join(root, "Dockerfile"), "utf8");
  const ignore = await readFile(path.join(root, ".dockerignore"), "utf8");
  const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
  const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8")) as {
    packages: { "node_modules/playwright": { version: string } };
  };
  assert.equal(compose.includes('VITE_AUTH_ENABLED: "false"'), false);
  assert.equal(compose.includes("5432:5432"), false);
  assert.equal(compose.includes("POSTGRES_PASSWORD: fanlink"), false);
  assert.equal(docker.includes(`playwright:v${lock.packages["node_modules/playwright"].version}`), true);
  assert.equal(ignore.includes("node_modules"), true);
  assert.equal(ignore.includes(".vercel"), true);
  assert.equal(gitignore.includes(".vercel"), true);
});
