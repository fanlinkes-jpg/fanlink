import { createElement as h, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useStickToBottom } from "../../../../src/features/use-stick-to-bottom.ts";

type Row = { key: string; tall: boolean };
const rows = (from: number, to: number): Row[] => Array.from({ length: to - from }, (_, index) => ({ key: `m${from + index}`, tall: (from + index) % 7 === 0 }));

type Api = {
  open: (thread: string, count: number) => void;
  prepend: (count: number) => void;
  append: (count: number) => void;
  bar: (px: number) => void;
  growLast: (px: number) => void;
};

function App() {
  const [thread, setThread] = useState<string | null>(null);
  const [list, setList] = useState<Row[]>([]);
  const [bar, setBar] = useState(0);
  const [extra, setExtra] = useState(0);
  const box = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const first = useRef(0);
  const last = useRef(0);
  const hook = useStickToBottom({ box, stick, threadKey: thread, tail: `${list.at(-1)?.key ?? ""}:${list.length}` });
  const api: Api = {
    open: (name, count) => { first.current = 0; last.current = count; setExtra(0); setThread(name); setList(rows(0, count)); },
    prepend: (count) => { first.current -= count; setList((current) => [...rows(first.current, first.current + count).map((row, index) => ({ ...row, key: `o${first.current + index}` })), ...current]); },
    append: (count) => { const from = last.current; last.current += count; setList((current) => [...current, ...rows(from, from + count)]); },
    bar: (px) => setBar(px),
    growLast: (px) => setExtra(px),
  };
  (window as unknown as { api: Api }).api = api;
  return h("div", { className: "shell" },
    h("div", { className: "bar", style: { height: bar } }),
    h("div", { className: "wrap" },
      h("ol", {
        ref: box,
        "data-thread-scroll": true,
        style: { scrollBehavior: "auto" },
        ...hook.intent,
        onLoadCapture: hook.follow,
        onScroll: (event: { currentTarget: HTMLElement }) => { hook.noteScroll(event.currentTarget); (window as unknown as { scrolls: number }).scrolls += 1; },
      }, list.map((row, index) => h("li", { key: row.key, "data-message-id": row.key, className: row.tall ? "tall" : "", style: index === list.length - 1 && extra ? { minHeight: extra } : undefined }, `${row.key} mensaje de prueba`)))));
}

(window as unknown as { scrolls: number }).scrolls = 0;
createRoot(document.getElementById("root") as HTMLElement).render(h(App));
