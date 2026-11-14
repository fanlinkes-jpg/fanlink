export const ONLINE_FAN_CAP = 100;

export type OnlineFanRow = {
  fanKey: string;
  fanName: string | null;
  fanHandle: string | null;
  avatarUrl: string | null;
  spentCents: number | null;
  currency: string | null;
  online: boolean;
  lists: string[];
};

/** El gasto de un fan. No suma la agencia. Sin campo, no es un cero. Sin moneda, $. */
export function spendLabel(cents: number | null, currency: string | null = null): string {
  if (cents == null) return "Sin datos";
  const sign = cents < 0 ? "-" : "";
  const amount = (Math.abs(cents) / 100).toFixed(2);
  if (!currency || currency === "USD" || currency === "$") return `${sign}$${amount}`;
  if (currency === "EUR") return cents === 0 ? "0 €" : `${sign}${amount} €`;
  return `${sign}${amount} ${currency}`;
}

export function onlineCapPhrase(count: number, cap: number): string {
  const shown = Math.min(count, cap);
  return `Vas a escribir a ${shown} fans en línea. El tope es ${cap}.`;
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
