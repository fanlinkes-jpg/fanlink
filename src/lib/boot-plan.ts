export function bootTasks(source: "pglite" | "neon"): Array<"database" | "scheduler"> {
  if (source === "pglite") return ["database", "scheduler"];
  return ["scheduler"];
}
