/** Solo un clic que abre el hilo pide marcar leído. Render, hover y el sondeo no. Un 0 ya leído tampoco. */
export function markReadOnOpen(source: "click" | "render" | "hover" | "poll", unread: number | null): boolean {
  return source === "click" && unread !== 0;
}
