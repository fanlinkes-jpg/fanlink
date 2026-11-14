export type OnlineFanRow = {
  fanKey: string;
  fanName: string | null;
  fanHandle: string | null;
  avatarUrl: string | null;
  spentCents: number | null;
  lists: string[];
};

/** El gasto de un fan. No suma la agencia. Sin campo, no es un cero. */
export function spendLabel(cents: number | null): string {
  if (cents == null) return "Sin datos";
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function filterOnlineFans<T extends { lists: readonly string[] }>(fans: readonly T[], list: string): T[] {
  if (list === "Todos") return [...fans];
  return fans.filter((fan) => fan.lists.includes(list));
}

export function onlineListNames(fans: readonly { lists: readonly string[] }[]): string[] {
  const names: string[] = [];
  for (const fan of fans) {
    for (const name of fan.lists) {
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

export function fanInitials(name: string | null, handle: string | null): string {
  const source = name?.trim() || handle?.replace(/^@/, "").trim() || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1
    ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
    : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
