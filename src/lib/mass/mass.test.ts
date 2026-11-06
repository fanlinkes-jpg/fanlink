import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fanProfiles } from "../fan-metrics.ts";
import { spendTone } from "../spend-tiers.ts";
import {
  FAN_WHALE_CENTS,
  LAUNCH_PHRASE,
  SIN_DATOS,
  bestSendHour,
  buildQueue,
  canCreateMass,
  canTransitionMass,
  confirmMassLaunch,
  composeMass,
  dryRunMass,
  formattedText,
  isWhale,
  massStats,
  massStatsForRole,
  snapshotFromSynced,
  spendBand,
  suggestPrice,
  textoIngresos,
  type MassDraft,
  type MassFan,
  type MassSnapshot,
} from "./index.ts";

const NOW = new Date("2026-11-06T10:00:00.000Z");
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("la ballena del masivo coincide con el perfil y los colores salen de spend-tiers", () => {
  assert.equal(FAN_WHALE_CENTS, 10_000);
  assert.equal(isWhale(10_000), true);
  assert.equal(isWhale(9_999), false);
  assert.equal(spendBand(null), null);
  assert.equal(spendBand(0), "cero");
  assert.equal(spendBand(5_000), "verde");
  assert.equal(spendTone(5_000).color, "#137333");
  assert.equal(spendBand(5_001), "azul");
  assert.equal(spendBand(20_001), "morado");
  assert.equal(spendBand(100_001), "dorado");
  assert.equal(
    spendBand(100, [
      { name: "mini", untilCents: 50 },
      { name: "resto", untilCents: Number.POSITIVE_INFINITY },
    ]),
    "resto",
  );
  const whale = fanProfiles({
    now: NOW,
    ppvSynced: false,
    fans: [moneyFan(FAN_WHALE_CENTS)],
    purchases: [],
    ppv: [],
  });
  const below = fanProfiles({
    now: NOW,
    ppvSynced: false,
    fans: [moneyFan(FAN_WHALE_CENTS - 1)],
    purchases: [],
    ppv: [],
  });
  assert.equal(whale[0]?.segments.includes("whale"), true);
  assert.equal(below[0]?.segments.includes("whale"), false);
});

test("el compositor acepta texto con formato, vista previa y PPV de 3 a 200 USD", () => {
  const draft = mustCompose({
    body: "Hola *Ana*",
    media: [
      { vaultId: "set-1", preview: true },
      { vaultId: "set-2", preview: false },
    ],
    priceCents: 500,
    scheduledAt: "2026-11-06T18:00:00.000Z",
    createdBy: { id: "ch-1", name: "Nuria" },
  });
  assert.equal(draft.status, "scheduled");
  assert.equal(formattedText(draft.body), "Hola *Ana*");
  assert.equal(draft.priceCents, 500);
  assert.equal(draft.rotate, true);
  assert.equal(draft.excludeBought, true);
  assert.equal(draft.createdBy?.name, "Nuria");
});

test("el PPV rechaza importes entre 0 y 3, decimales y un gratis con vista previa", () => {
  for (const priceCents of [0, 100, 299, 350, 20_100]) {
    const result = composeMass(baseInput({ priceCents }));
    assert.equal(result.ok, false, String(priceCents));
  }
  const preview = composeMass(
    baseInput({ media: [{ vaultId: "set-1", preview: true }] }),
  );
  assert.equal(preview.ok, false);
  assert.match(preview.ok ? "" : preview.errors.join(" "), /gratis/);
});

test("una palabra prohibida retiene el borrador y el dry-run no lo cola", () => {
  const composed = composeMass(
    baseInput({ body: "Escríbeme por telegram", stopWords: ["Telegram"] }),
  );
  assert.equal(composed.ok, true);
  if (!composed.ok) return;
  assert.equal(composed.draft.status, "held");
  const run = dryRunMass({
    draft: composed.draft,
    snapshot: snapshotOf([fan("7")]),
    now: NOW,
    env: {},
  });
  assert.equal(run.delivered, false);
  assert.equal(run.queue.length, 0);
  assert.equal(run.status, "bloqueado");
});

test("el segmento usa tramo, suscripción, actividad y última compra", () => {
  const snapshot = ready([
    fan("activo", {
      spentCents: 10_000,
      spend30Cents: 6_000,
      lastActiveAt: "2026-11-06T09:00:00.000Z",
      lastPurchaseAt: "2026-11-01T00:00:00.000Z",
    }),
    fan("caducado", {
      status: "expired",
      spentCents: 10_000,
      lastActiveAt: "2026-11-06T09:00:00.000Z",
    }),
    fan("frio", {
      spentCents: 100,
      lastActiveAt: "2026-08-01T00:00:00.000Z",
    }),
    fan("sin-gasto", { spentCents: null }),
  ]);
  const run = dryRunMass({
    draft: mustCompose({
      segment: {
        spendTiers: ["ballena"],
        spendWindow: "lifetime",
        subscription: "activa",
        activeWithinDays: 7,
        purchasedWithinDays: 30,
      },
      rotate: false,
      excludeBought: false,
    }),
    snapshot,
    now: NOW,
    env: {},
  });
  assert.deepEqual(
    run.queue.map((item) => item.fanKey),
    ["activo"],
  );
  assert.equal(
    run.skippedMissing.some((row) => row.fanKey === "sin-gasto"),
    true,
  );
  assert.equal(run.audience, 1);
});

test("sin listas de OnlyFans el segmento no inventa miembros", () => {
  const snapshot = snapshotFromSynced({
    accountId: "cuenta-1",
    now: NOW,
    fans: [syncedFan("7", "Fan Uno", 1_500)],
    messages: [],
    purchases: [],
  });
  assert.equal(snapshot.ofLists, null);
  assert.equal(snapshot.contentEvents, null);
  assert.equal(snapshot.sendUsage, null);
  const run = dryRunMass({
    draft: mustCompose({
      segment: { ofListIds: ["lista-vip"] },
      rotate: false,
      excludeBought: false,
    }),
    snapshot,
    now: NOW,
    env: {},
  });
  assert.equal(run.audience, SIN_DATOS);
  assert.equal(run.queue.length, 0);
  assert.equal(run.status, "sin_datos");
});

test("la lista sincronizada, la exclusión de compra y la rotación recortan la audiencia", () => {
  const snapshot = ready([fan("7"), fan("8"), fan("9")], {
    ofLists: [{ id: "vip", name: "VIP", fanKeys: ["7", "8", "9"] }],
    contentEvents: [
      { fanKey: "7", vaultId: "set-1", kind: "comprado" },
      { fanKey: "8", vaultId: "set-1", kind: "recibido" },
    ],
    vaultIds: ["set-1"],
  });
  const run = dryRunMass({
    draft: mustCompose({
      media: [{ vaultId: "set-1", preview: false }],
      priceCents: 300,
      segment: { ofListIds: ["vip"] },
    }),
    snapshot,
    now: NOW,
    env: {},
  });
  assert.deepEqual(
    run.queue.map((item) => item.fanKey),
    ["9"],
  );
  assert.deepEqual(
    run.excluded.map((row) => row.reason),
    ["Ya compró este contenido", "Rotación: ya recibió este contenido"],
  );
});

test("sin historial de contenido no se cola un masivo con media", () => {
  const snapshot = snapshotOf([fan("7")], {
    vaultIds: ["set-1"],
    contentEvents: null,
  });
  const run = dryRunMass({
    draft: mustCompose({
      media: [{ vaultId: "set-1", preview: false }],
      priceCents: 300,
    }),
    snapshot,
    now: NOW,
    env: {},
  });
  assert.equal(run.queue.length, 0);
  assert.equal(run.audience, 1);
  assert.ok(run.errors.some((error) => error.startsWith(SIN_DATOS)));
});

test("el precio sugerido y la mejor hora salen del historial o dicen Sin datos", () => {
  const messages = [
    {
      fanKey: "7",
      fromFan: false,
      sentAt: "2026-11-01T00:00:00.000Z",
      priceCents: 500,
      purchased: true,
    },
    {
      fanKey: "7",
      fromFan: false,
      sentAt: "2026-11-02T00:00:00.000Z",
      priceCents: 900,
      purchased: true,
    },
    {
      fanKey: "7",
      fromFan: false,
      sentAt: "2026-11-03T00:00:00.000Z",
      priceCents: 100,
      purchased: true,
    },
    {
      fanKey: "7",
      fromFan: true,
      sentAt: "2026-11-05T18:00:00.000Z",
      priceCents: null,
      purchased: null,
    },
    {
      fanKey: "7",
      fromFan: true,
      sentAt: "2026-11-05T18:30:00.000Z",
      priceCents: null,
      purchased: null,
    },
    {
      fanKey: "8",
      fromFan: true,
      sentAt: "2026-11-04T09:00:00.000Z",
      priceCents: null,
      purchased: null,
    },
  ];
  assert.deepEqual(suggestPrice(messages, ["7"]), { cents: 700, sample: 2 });
  assert.equal(suggestPrice(messages, ["8"]), SIN_DATOS);
  assert.equal(suggestPrice(null, ["7"]), SIN_DATOS);
  assert.deepEqual(bestSendHour(messages, ["7", "8"]), {
    hourUtc: 18,
    samples: 3,
  });
  assert.deepEqual(
    bestSendHour(
      [
        ...messages,
        {
          fanKey: "8",
          fromFan: true,
          sentAt: "2026-11-04T09:30:00.000Z",
          priceCents: null,
          purchased: null,
        },
      ],
      ["7", "8"],
    ),
    { hourUtc: 9, samples: 4 },
  );
  assert.equal(bestSendHour([], ["7"]), SIN_DATOS);
});

test("las estadísticas no rellenan vistos, compras ni ingresos que no vienen", () => {
  const empty = massStats({ createdBy: null, deliveries: null });
  assert.equal(empty.sent, SIN_DATOS);
  assert.equal(empty.viewed, SIN_DATOS);
  assert.equal(empty.purchases, SIN_DATOS);
  assert.equal(empty.buyRate, SIN_DATOS);
  assert.equal(empty.revenueCents, SIN_DATOS);
  assert.equal(empty.createdBy, SIN_DATOS);
  assert.equal(textoIngresos(empty.revenueCents), SIN_DATOS);

  const partial = massStats({
    createdBy: { name: "Nuria" },
    deliveries: [
      { fanKey: "7", status: "enviado", purchased: true },
      { fanKey: "8", status: "enviado", purchased: false },
    ],
  });
  assert.equal(partial.sent, 2);
  assert.equal(partial.viewed, SIN_DATOS);
  assert.equal(partial.purchases, 1);
  assert.equal(partial.buyRate, 0.5);
  assert.equal(partial.revenueCents, SIN_DATOS);
  assert.equal(partial.createdBy, "Nuria");

  const none = massStats({ createdBy: { name: "Nuria" }, deliveries: [] });
  assert.equal(none.sent, 0);
  assert.equal(none.buyRate, SIN_DATOS);
  assert.equal(none.revenueCents, 0);
});

test("el dry-run personaliza, no copia la cola en enviados y deja el follow-up sin destinatarios", () => {
  const run = dryRunMass({
    draft: mustCompose({
      body: "Hola {nombre}",
      followUp: { body: "¿Lo viste?", afterHours: 24 },
      unsendAfterHours: 12,
      createdBy: { id: "ch-1", name: "Nuria" },
    }),
    snapshot: ready([fan("7", { name: "Ana López", handle: "@ana" })]),
    now: NOW,
    env: {},
  });
  assert.equal(run.delivered, false);
  assert.equal(run.mode, "dry-run");
  assert.equal(run.network, "sin-llamada");
  assert.equal(run.gate.open, false);
  assert.equal(run.queue[0]?.text, "Hola Ana");
  assert.equal(run.queue[0]?.unsendAt, "2026-11-06T22:00:00.000Z");
  assert.equal(run.stats.sent, SIN_DATOS);
  assert.notEqual(run.stats.sent, run.queue.length);
  assert.equal(run.followUp?.recipients, SIN_DATOS);
  assert.equal(run.quota.sentLastHour, 0);
});

test("el flag y la allowlist siguen cerrados salvo true y la cuenta concreta, y aun así no se envía", () => {
  const draft = mustCompose({});
  const snapshot = snapshotOf([fan("7")], { messages: [] });
  const closed = dryRunMass({
    draft,
    snapshot,
    now: NOW,
    env: {
      FANLINK_ENABLE_MASS_SEND: "TRUE",
      FANLINK_SEND_ALLOW_ACCOUNTS: "cuenta-1",
    },
  });
  assert.equal(closed.gate.open, false);
  assert.equal(closed.delivered, false);
  const missing = dryRunMass({
    draft,
    snapshot,
    now: NOW,
    env: {
      FANLINK_ENABLE_MASS_SEND: "true",
      FANLINK_SEND_ALLOW_ACCOUNTS: " otra ",
    },
  });
  assert.equal(missing.gate.open, false);
  const sendOff = dryRunMass({
    draft,
    snapshot,
    now: NOW,
    env: {
      FANLINK_ENABLE_MASS_SEND: "true",
      FANLINK_SEND_ALLOW_ACCOUNTS: "cuenta-1",
    },
  });
  assert.equal(sendOff.gate.open, false);
  const open = dryRunMass({
    draft,
    snapshot: ready([fan("7")]),
    now: NOW,
    env: {
      FANLINK_ENABLE_SEND: "true",
      FANLINK_ENABLE_MASS_SEND: "true",
      FANLINK_SEND_ALLOW_ACCOUNTS: "cuenta-1, otra",
    },
  });
  assert.equal(open.gate.open, true);
  assert.equal(open.delivered, false);
  assert.equal(open.network, "sin-llamada");
  assert.equal(open.queue.length, 1);
});

test("la cola no supone uso cero, respeta el día de la cuenta y quita fans repetidos", () => {
  const pace = { minGapMs: 0, maxGapMs: 0, maxPerHour: 2, maxPerDay: 3 };
  const start = NOW.getTime();
  const unknown = buildQueue({
    fanKeys: ["a", "a", "b"],
    startAt: start,
    now: start,
    pace,
    usage: null,
    timeZone: "UTC",
  });
  assert.deepEqual(unknown.slots, []);
  assert.deepEqual(unknown.held, ["a", "b"]);
  assert.equal(unknown.sentLastHour, SIN_DATOS);
  const open = buildQueue({
    fanKeys: ["a", "a", "b", "c"],
    startAt: start,
    now: start,
    pace,
    usage: { sentLastHour: 0, sentLastDay: 0 },
    timeZone: "UTC",
  });
  assert.deepEqual(
    open.slots.map((slot) => slot.fanKey),
    ["a", "b", "c"],
  );
  assert.equal(open.slots[2]?.at, start + 3_600_000);
  const fullDay = buildQueue({
    fanKeys: ["a", "b"],
    startAt: start,
    now: start,
    pace: { ...pace, maxPerDay: 1 },
    usage: { sentLastHour: 0, sentLastDay: 1 },
    timeZone: "UTC",
  });
  assert.equal(fullDay.slots.length, 0);
  assert.deepEqual(fullDay.held, ["a", "b"]);
  const madrid = Date.parse("2026-11-06T22:30:00.000Z");
  const inMadrid = buildQueue({
    fanKeys: ["a", "b"],
    startAt: madrid,
    now: madrid,
    pace: { ...pace, maxPerHour: 1, maxPerDay: 5 },
    usage: { sentLastHour: 0, sentLastDay: 0 },
    timeZone: "Europe/Madrid",
  });
  assert.deepEqual(
    inMadrid.slots.map((slot) => slot.fanKey),
    ["a"],
  );
  assert.deepEqual(inMadrid.held, ["b"]);
  const inUtc = buildQueue({
    fanKeys: ["a", "b"],
    startAt: madrid,
    now: madrid,
    pace: { ...pace, maxPerHour: 1, maxPerDay: 5 },
    usage: { sentLastHour: 0, sentLastDay: 0 },
    timeZone: "UTC",
  });
  assert.deepEqual(
    inUtc.slots.map((slot) => slot.fanKey),
    ["a", "b"],
  );
});

test("el gasto a 30 días sigue la cobertura del perfil y no se copia del total", () => {
  const snapshot = snapshotFromSynced({
    accountId: "cuenta-1",
    now: NOW,
    fans: [syncedFan("7", "Fan Uno", 8_000)],
    messages: [
      {
        fanKey: "7",
        fromFan: true,
        sentAt: "2026-11-06T09:00:00.000Z",
        priceCents: null,
        purchased: null,
      },
    ],
    purchases: [
      { fanKey: "7", occurredAt: "2026-11-05T00:00:00.000Z", grossCents: 500 },
    ],
  });
  assert.equal(snapshot.fans?.[0]?.spend30Cents, null);
  assert.equal(snapshot.fans?.[0]?.spentCents, 8_000);
  assert.equal(snapshot.fans?.[0]?.lastActiveAt, "2026-11-06T09:00:00.000Z");
  const covered = snapshotFromSynced({
    accountId: "cuenta-1",
    now: NOW,
    fans: [syncedFan("7", "Fan Uno", 8_000)],
    messages: [],
    purchases: [
      { fanKey: "7", occurredAt: "2026-09-01T00:00:00.000Z", grossCents: 100 },
      { fanKey: "7", occurredAt: "2026-11-05T00:00:00.000Z", grossCents: 500 },
    ],
  });
  assert.equal(covered.fans?.[0]?.spend30Cents, 500);
  assert.equal(spendBand(covered.fans?.[0]?.spend30Cents ?? null), "verde");
  assert.equal(snapshot.timeZone, null);
  assert.equal(snapshot.sendUsage, null);
});

test("crear admite admin o el permiso masivos, y lanzar pide dos confirmaciones del admin", () => {
  assert.equal(canCreateMass(null), false);
  assert.equal(canCreateMass({ role: "member", perms: ["campanas"] }), false);
  assert.equal(canCreateMass({ role: "member", perms: ["masivos"] }), true);
  assert.equal(canCreateMass({ role: "owner", perms: [] }), true);
  const half = confirmMassLaunch({
    actor: { role: "owner", perms: [] },
    draftId: "mass-1",
    confirmDraftId: "mass-1",
    confirmPhrase: "si",
  });
  assert.equal(half.ok, false);
  const member = confirmMassLaunch({
    actor: { role: "member", perms: ["masivos"] },
    draftId: "mass-1",
    confirmDraftId: "mass-1",
    confirmPhrase: LAUNCH_PHRASE,
  });
  assert.equal(member.ok, false);
  const both = confirmMassLaunch({
    actor: { role: "owner", perms: [] },
    draftId: "mass-1",
    confirmDraftId: "mass-1",
    confirmPhrase: LAUNCH_PHRASE,
  });
  assert.equal(both.ok, true);
});

test("un chatter no ve ingresos ni buy rate, aunque existan", () => {
  const stats = massStats({
    createdBy: { name: "Nuria" },
    deliveries: [
      {
        fanKey: "7",
        status: "enviado",
        purchased: true,
        viewed: true,
        priceCents: 500,
      },
      {
        fanKey: "8",
        status: "enviado",
        purchased: false,
        viewed: false,
        priceCents: 500,
      },
    ],
  });
  assert.equal(stats.revenueCents, 500);
  assert.equal(stats.buyRate, 0.5);
  const hidden = massStatsForRole(stats, "member");
  assert.equal(hidden.revenueCents, null);
  assert.equal(hidden.buyRate, null);
  assert.equal(hidden.sent, 2);
  const owner = massStatsForRole(stats, "owner");
  assert.equal(owner.revenueCents, 500);
  assert.equal(owner.buyRate, 0.5);
});

test("el masivo puede cancelarse, enviarse y reintentarse", () => {
  assert.equal(canTransitionMass("scheduled", "sent"), true);
  assert.equal(canTransitionMass("scheduled", "cancelled"), true);
  assert.equal(canTransitionMass("scheduled", "retry"), true);
  assert.equal(canTransitionMass("retry", "sent"), true);
  assert.equal(canTransitionMass("sent", "retry"), false);
  assert.equal(canTransitionMass("cancelled", "draft"), false);
});

test("el módulo de masivos no llama a la API ni lee la clave de sesión", async () => {
  const files = [
    "src/lib/spend-tiers.ts",
    "src/lib/mass/types.ts",
    "src/lib/mass/text.ts",
    "src/lib/mass/access.ts",
    "src/lib/mass/spend.ts",
    "src/lib/mass/status.ts",
    "src/lib/mass/gates.ts",
    "src/lib/mass/composer.ts",
    "src/lib/mass/segments.ts",
    "src/lib/mass/smart.ts",
    "src/lib/mass/stats.ts",
    "src/lib/mass/queue.ts",
    "src/lib/mass/dry-run.ts",
    "src/lib/mass/from-synced.ts",
    "src/lib/mass/index.ts",
    "server/of-sessions/campaigns/mass-store.ts",
  ];
  const banned = ["api2", "onlyfans.com", "FANLINK_SESSION_KEY", "fetch("];
  for (const file of files) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    for (const token of banned)
      assert.equal(source.includes(token), false, `${file} contiene ${token}`);
  }
});

function moneyFan(spentCents: number) {
  return {
    fanKey: "7",
    name: "Fan",
    status: "active" as const,
    subscribedAt: null,
    renewAuto: null,
    spentCents,
    lastInteractionAt: null,
  };
}

function syncedFan(fanKey: string, name: string, spentCents: number) {
  return {
    fanKey,
    name,
    handle: `@${fanKey}`,
    status: "active" as const,
    spentCents,
    subscribedAt: "2026-10-01T00:00:00.000Z",
    renewAuto: true,
  };
}

function fan(fanKey: string, patch: Partial<MassFan> = {}): MassFan {
  return {
    fanKey,
    name: `Fan ${fanKey}`,
    handle: `@${fanKey}`,
    status: "active",
    spentCents: 0,
    spend30Cents: null,
    lastActiveAt: null,
    lastPurchaseAt: null,
    ...patch,
  };
}

function snapshotOf(
  fans: MassFan[],
  patch: Partial<MassSnapshot> = {},
): MassSnapshot {
  return {
    accountId: "cuenta-1",
    fans,
    messages: patch.messages ?? null,
    ofLists: patch.ofLists ?? null,
    contentEvents: patch.contentEvents ?? null,
    vaultIds: patch.vaultIds ?? null,
    sendUsage: patch.sendUsage ?? null,
    timeZone: patch.timeZone ?? null,
  };
}

function baseInput(
  patch: Parameters<typeof composeMass>[0] extends infer T ? Partial<T> : never,
) {
  return {
    accountId: "cuenta-1",
    name: "Viernes",
    body: "Hola {nombre}",
    segment: { includeAll: true },
    now: NOW,
    createId: () => "mass-1",
    idempotencyKey: "clave-1",
    ...patch,
  };
}

function ready(
  fans: MassFan[],
  patch: Partial<MassSnapshot> = {},
): MassSnapshot {
  return snapshotOf(fans, {
    messages: [],
    sendUsage: { sentLastHour: 0, sentLastDay: 0 },
    timeZone: "UTC",
    ...patch,
  });
}

function mustCompose(patch: Parameters<typeof baseInput>[0]): MassDraft {
  const result = composeMass(baseInput(patch));
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join(" | "));
  if (!result.ok) throw new Error("borrador inválido");
  return result.draft;
}
