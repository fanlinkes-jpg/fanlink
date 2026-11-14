import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChatList } from "../sync/chats.ts";
import {
  SUBSCRIBER_PAGE_CAP,
  USER_SPEND_CAP,
  clearFanSpendCache,
  collectFanSpend,
  subscriberRows,
  totalSummCents,
  type SpendPage,
} from "../sync/fan-spend.ts";
import { spendTone } from "../../../src/lib/spend-tiers.ts";
import { rowSpendCents, spendLogLine } from "../../../src/lib/row-spend.ts";

const NOW = 1_700_000_000_000;

test("un array pelado de suscriptores y un users/{id} con totalSumm 0 valen $0.00", async () => {
  clearFanSpendCache();
  const rows = subscriberRows([{ id: 9, subscribedOnData: { totalSumm: 0, tipsSumm: 3 } }]);
  assert.equal(rows?.[0]?.spentCents, 0);
  const urls: string[] = [];
  const logs: string[] = [];
  const read = await collectFanSpend({
    accountId: "acc",
    creatorId: "3zk7kbr",
    threads: [{ fanKey: "9", spentCents: null }, { fanKey: "4", spentCents: null }],
    visibleIds: ["9", "4"],
    request: async (path) => {
      urls.push(path);
      if (path.includes("/subscriptions/subscribers")) {
        return page(200, [{ id: 9, name: "Ana", subscribedOnData: { totalSumm: 0 } }]);
      }
      return page(200, { id: 4, subscribedOnData: { totalSumm: 0, subscribesSumm: 1, tipsSumm: 2, postsSumm: 0, messagesSumm: 0 } });
    },
    now: NOW,
    log: (line) => logs.push(line),
  });
  assert.equal(read.byFan.get("9"), 0);
  assert.equal(read.byFan.get("4"), 0);
  assert.equal(spendTone(read.byFan.get("4") ?? null).label, "$0.00");
  assert.equal(urls.filter((url) => url.startsWith("/api2/v2/users/")).length, 1);
  assert.equal(logs[0], "[fanlink:spend] creator=3zk7kbr thread=0 card=0 subscribers=1 users=1 still null=0");
  assert.equal(logs[0]?.includes("fan="), false);
  const again = await collectFanSpend({
    accountId: "acc",
    creatorId: "3zk7kbr",
    threads: [{ fanKey: "4", spentCents: null }],
    visibleIds: ["4"],
    request: async () => {
      throw new Error("no debe repetirse");
    },
    now: NOW + 1_000,
  });
  assert.equal(again.byFan.get("4"), 0);
  clearFanSpendCache();
});

test("sin subscribedOnData o con desglose y sin total el gasto queda null", () => {
  assert.equal(totalSummCents({ id: "8", name: "Bo" }), null);
  assert.equal(totalSummCents({ subscribedOnData: { tipsSumm: 4, subscribesSumm: 1, postsSumm: 0, messagesSumm: 0 } }), null);
  const parsed = parseChatList({
    list: [{
      id: "8",
      withUser: { id: "8", name: "Bo", subscribedOnData: { tipsSumm: 4, subscribesSumm: 1 } },
      lastMessage: { text: "hola", createdAt: "2026-11-12T00:00:00.000Z", fromUser: { id: "8" } },
      unreadMessagesCount: 0,
    }],
  }, "42");
  assert.equal(parsed[0]?.spentCents, null);
  assert.equal(spendTone(parsed[0]?.spentCents ?? null).label, "Sin datos");
  assert.equal(rowSpendCents(null, null, null), null);
  assert.equal(rowSpendCents(null, 0, null), 0);
  assert.equal(spendLogLine({ creatorId: "3zk7kbr", thread: 1, card: 0, subscribers: 0, users: 0, stillNull: 2 }).includes("42"), false);
});

test("un 429 corta la tanda y el tope de users/{id} es 10", async () => {
  clearFanSpendCache();
  const urls: string[] = [];
  const stopped = await collectFanSpend({
    accountId: "acc-429",
    creatorId: "3zk7kbr",
    threads: [{ fanKey: "1", spentCents: null }, { fanKey: "2", spentCents: null }],
    visibleIds: ["1", "2"],
    request: async (path) => {
      urls.push(path);
      if (path.includes("/subscriptions/subscribers")) return page(200, []);
      if (path.endsWith("/users/1")) return page(429, null, 4000);
      return page(200, { id: 2, subscribedOnData: { totalSumm: 1 } });
    },
    now: NOW,
  });
  assert.equal(stopped.stopped?.retryAfterMs, 4000);
  assert.equal(stopped.byFan.has("2"), false);
  assert.equal(urls.filter((url) => url.includes("/users/")).length, 1);

  clearFanSpendCache();
  const many = Array.from({ length: 15 }, (_, index) => String(index + 1));
  const called: string[] = [];
  await collectFanSpend({
    accountId: "acc-cap",
    creatorId: "3zk7kbr",
    threads: many.map((id) => ({ fanKey: id, spentCents: null })),
    visibleIds: many,
    request: async (path) => {
      called.push(path);
      if (path.includes("/subscriptions/subscribers")) return page(200, []);
      const id = path.split("/").pop();
      return page(200, { id, subscribedOnData: { totalSumm: 1 } });
    },
    now: NOW,
  });
  assert.equal(called.filter((url) => url.includes("/users/")).length, USER_SPEND_CAP);
  clearFanSpendCache();
});

test("un 403 de suscriptores no se repite a los 15 s y la paginación tiene tope", async () => {
  clearFanSpendCache();
  const logs: string[] = [];
  let calls = 0;
  const once = () => collectFanSpend({
    accountId: "acc-403",
    creatorId: "3zk7kbr",
    threads: [{ fanKey: "1", spentCents: null }],
    visibleIds: [],
    request: async () => {
      calls += 1;
      return page(403, null);
    },
    now: NOW,
    log: (line) => logs.push(line),
  });
  await once();
  await collectFanSpend({
    accountId: "acc-403",
    creatorId: "3zk7kbr",
    threads: [{ fanKey: "1", spentCents: null }],
    visibleIds: [],
    request: async () => {
      calls += 1;
      return page(200, []);
    },
    now: NOW + 15_000,
    log: (line) => logs.push(line),
  });
  assert.equal(calls, 1);
  assert.equal(logs.some((line) => line.includes("subscribers status=403")), true);
  assert.equal(logs.some((line) => line.includes("fan=")), false);

  clearFanSpendCache();
  let pages = 0;
  await collectFanSpend({
    accountId: "acc-pages",
    creatorId: "3zk7kbr",
    threads: [],
    visibleIds: [],
    request: async () => {
      pages += 1;
      return page(200, Array.from({ length: 10 }, (_, index) => ({
        id: pages * 10 + index,
        subscribedOnData: { totalSumm: 1 },
      })));
    },
    now: NOW,
  });
  assert.equal(pages, SUBSCRIBER_PAGE_CAP);
  clearFanSpendCache();
});

function page(status: number, body: unknown, retryAfterMs = 0): SpendPage {
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    retryAfterMs,
    sessionRejected: status === 401,
  };
}
