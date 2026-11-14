import { createElement } from "react";
import { rowSpendCents } from "./row-spend.ts";
import { spendTone } from "./spend-tiers.ts";

/** El gasto bajo el avatar: hilo, luego ficha, luego lo pedido. */
export function FanSpendLabel(props: { thread: number | null; card: number | null; fetched: number | null }) {
  const tone = spendTone(rowSpendCents(props.thread, props.card, props.fetched));
  return createElement("span", {
    className: "text-[10px] font-medium",
    style: { color: tone.color ?? "#6d7585" },
  }, tone.label);
}
