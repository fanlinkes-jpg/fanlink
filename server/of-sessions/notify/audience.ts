import type { AlertTarget } from "./plan.ts";

export type AlertMode = "all" | "assigned" | "users";

export type AlertPerson = {
  userId: string;
  phone: string | null;
  enabled: boolean;
  quietMinutes: number;
  creatorIds: string[];
};

export function alertMode(raw: string | undefined): AlertMode {
  const mode = (raw ?? "all").trim().toLowerCase();
  if (mode === "assigned" || mode === "users") return mode;
  return "all";
}

export function alertUserList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Por defecto avisa a todos los chatters con avisos. `assigned` usa la cuenta. `users` es una lista. */
export function targetsForCreator(
  people: AlertPerson[],
  creatorId: string,
  mode: AlertMode,
  userList: string[],
): AlertTarget[] {
  const listed = new Set(userList);
  return people
    .filter((person) => {
      if (mode === "assigned") return person.creatorIds.includes(creatorId);
      if (mode === "users") return listed.has(person.userId);
      return true;
    })
    .map((person) => ({
      userId: person.userId,
      phone: person.phone,
      enabled: person.enabled,
      quietMinutes: person.quietMinutes,
    }));
}
