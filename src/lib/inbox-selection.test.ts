import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createElement, useEffect } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { clearAccountChatPace, withAccountApi } from "../../server/of-sessions/sync/api-list-pace.ts";
import { MARK_SEEN_MS, arrowIgnored, useInboxSelection } from "./inbox-selection.ts";

type Row = { id: string; unread: number | null; lastMessageAt: string };

const dom = new Window({ url: "https://fanlink.test/mensajes" });
Object.assign(globalThis, {
  window: dom,
  document: dom.document,
  HTMLElement: dom.HTMLElement,
  Node: dom.Node,
  KeyboardEvent: dom.KeyboardEvent,
  Event: dom.Event,
  IS_REACT_ACT_ENVIRONMENT: true,
});

test("Sin leer con 3 no leídos marca uno; Todos y un mensaje nuevo no marcan otro", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const posts: string[] = [];
  const view = await mount({
    threads: [
      row("a", 2, "2026-11-14T00:00:03.000Z"),
      row("b", 4, "2026-11-14T00:00:02.000Z"),
      row("c", 1, "2026-11-14T00:00:01.000Z"),
    ],
    filter: "sin-leer",
    posts,
  });
  try {
    await act(async () => {
      mock.timers.tick(MARK_SEEN_MS);
    });
    assert.deepEqual(posts, ["a"]);
    assert.equal(text("selected"), "a");
    await view.show({
      threads: [
        row("a", 0, "2026-11-14T00:00:03.000Z"),
        row("b", 4, "2026-11-14T00:00:02.000Z"),
        row("c", 1, "2026-11-14T00:00:01.000Z"),
      ],
      filter: "sin-leer",
      posts,
    });
    await act(async () => {
      mock.timers.tick(MARK_SEEN_MS);
    });
    assert.deepEqual(posts, ["a"]);
    assert.equal(text("selected"), "a");
    assert.equal(text("visible").split(",").includes("a"), true);

    const todos = [row("a", 0, "2026-11-14T00:00:03.000Z"), row("b", 0, "2026-11-14T00:00:02.000Z")];
    await view.show({ threads: todos, filter: "todos", posts });
    await act(async () => {
      mock.timers.tick(MARK_SEEN_MS);
    });
    await view.show({
      threads: [row("z", 3, "2026-11-14T00:00:09.000Z"), ...todos],
      filter: "todos",
      posts,
    });
    await act(async () => {
      mock.timers.tick(MARK_SEEN_MS);
    });
    assert.deepEqual(posts, ["a"]);
    assert.equal(text("selected"), "a");
  } finally {
    await view.close();
    mock.timers.reset();
  }
});

test("la marca espera 800 ms a la vista y no ocupa el lector; salir o tapar la pestaña la cancela", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const posts: string[] = [];
  let release: () => void = () => undefined;
  const held = withAccountApi("acc-visto", () => new Promise<void>((resolve) => {
    release = resolve;
  }));
  const view = await mount({
    threads: [row("a", 2, "2026-11-14T00:00:02.000Z"), row("b", 5, "2026-11-14T00:00:01.000Z")],
    filter: "todos",
    posts,
  });
  try {
    await act(async () => {
      mock.timers.tick(MARK_SEEN_MS - 1);
    });
    assert.deepEqual(posts, []);
    release();
    await held;
    assert.deepEqual(posts, []);
    await act(async () => {
      mock.timers.tick(1);
    });
    assert.deepEqual(posts, ["a"]);

    await view.close();
    posts.length = 0;
    const moved = await mount({
      threads: [row("c", 2, "2026-11-14T00:00:04.000Z"), row("d", 2, "2026-11-14T00:00:03.000Z")],
      filter: "todos",
      posts,
    });
    try {
      await act(async () => {
        mock.timers.tick(100);
      });
      await act(async () => {
        document.getElementById("go-d")?.click();
      });
      await act(async () => {
        mock.timers.tick(MARK_SEEN_MS);
      });
      assert.deepEqual(posts, ["d"]);
    } finally {
      await moved.close();
    }

    posts.length = 0;
    let shown = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => shown });
    const hidden = await mount({
      threads: [row("e", 4, "2026-11-14T00:00:05.000Z")],
      filter: "todos",
      posts,
    });
    try {
      shown = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        mock.timers.tick(MARK_SEEN_MS);
      });
      assert.deepEqual(posts, []);
      shown = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        mock.timers.tick(MARK_SEEN_MS - 1);
      });
      assert.deepEqual(posts, []);
      await act(async () => {
        mock.timers.tick(1);
      });
      assert.deepEqual(posts, ["e"]);
      await hidden.show({
        threads: [row("e", 9, "2026-11-14T00:00:05.000Z")],
        filter: "todos",
        posts,
      });
      await act(async () => {
        mock.timers.tick(MARK_SEEN_MS);
      });
      assert.deepEqual(posts, ["e", "e"]);
    } finally {
      await hidden.close();
    }
  } finally {
    release();
    await held.catch(() => undefined);
    await view.close();
    mock.timers.reset();
    clearAccountChatPace();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  }
});

test("las flechas no cambian el hilo si el foco está en el compositor", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const posts: string[] = [];
  const view = await mount({
    threads: [row("a", 0, "2026-11-14T00:00:02.000Z"), row("b", 1, "2026-11-14T00:00:01.000Z")],
    filter: "todos",
    posts,
  });
  try {
    const composer = document.getElementById("composer");
    assert.equal(composer?.isContentEditable, true);
    assert.equal(arrowIgnored(composer), true);
    await act(async () => {
      composer?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    assert.equal(text("selected"), "a");
    await act(async () => {
      document.getElementById("down")?.click();
    });
    assert.equal(text("selected"), "b");
  } finally {
    await view.close();
    mock.timers.reset();
  }
});

function InboxBody(props: {
  threads: Row[];
  filter: "todos" | "sin-leer";
  posts: string[];
}) {
  const view = useInboxSelection({
    threads: props.threads,
    matches: (thread) => props.filter === "todos" || (thread.unread ?? 0) > 0,
    hidden: () => false,
    showHidden: false,
    onMark: (thread) => {
      props.posts.push(thread.id);
    },
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => view.onArrow(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.onArrow]);
  return createElement("div", null,
    createElement("span", { id: "selected" }, view.selected?.id ?? ""),
    createElement("span", { id: "visible" }, view.visible.map((thread) => thread.id).join(",")),
    createElement("button", {
      id: "down",
      onClick: () => view.onArrow({ key: "ArrowDown", target: null, preventDefault() {} }),
    }, "bajar"),
    createElement("button", {
      id: "go-d",
      onClick: () => view.choose({ id: "d" }),
    }, "aviso"),
    createElement("div", { id: "composer", contentEditable: "true", role: "textbox", suppressContentEditableWarning: true }, "hola"),
  );
}

async function mount(props: { threads: Row[]; filter: "todos" | "sin-leer"; posts: string[] }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const show = async (next: typeof props) => {
    await act(async () => {
      root.render(createElement(InboxBody, next));
    });
  };
  await show(props);
  let closed = false;
  return {
    show,
    close: async () => {
      if (closed) return;
      closed = true;
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function row(id: string, unread: number | null, lastMessageAt: string): Row {
  return { id, unread, lastMessageAt };
}

function text(id: string): string {
  return document.getElementById(id)?.textContent ?? "";
}
