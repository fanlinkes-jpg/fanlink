export type AlertEvent = {
  id: string;
  creatorId: string;
  creatorName: string;
  fanKey: string | null;
  fanName: string | null;
  excerpt: string;
  sentAt: string;
};

export type AlertTarget = {
  userId: string;
  phone: string | null;
  enabled: boolean;
  quietMinutes: number;
};

export type RecentAlert = {
  userId: string;
  creatorId: string;
  fanKey: string;
  sentAt: string;
};

export type PlannedAlert = {
  userId: string;
  phone: string;
  creatorId: string;
  fanKeys: string[];
  eventIds: string[];
  body: string;
};

/** Un WhatsApp por chatter, juntando los fans nuevos y saltando los avisados hace poco. */
export function planAlerts(input: {
  events: AlertEvent[];
  targetsByCreator: Map<string, AlertTarget[]>;
  recent: RecentAlert[];
  now: Date;
}): PlannedAlert[] {
  const grouped = new Map<string, PlannedAlert>();
  for (const event of input.events) {
    const fanKey = event.fanKey ?? event.fanName ?? "fan";
    const targets = input.targetsByCreator.get(event.creatorId) ?? [];
    for (const target of targets) {
      if (!target.enabled || !target.phone) continue;
      const quietMs = Math.max(1, target.quietMinutes) * 60_000;
      const recent = input.recent.find(
        (item) =>
          item.userId === target.userId &&
          item.creatorId === event.creatorId &&
          item.fanKey === fanKey &&
          input.now.getTime() - Date.parse(item.sentAt) < quietMs,
      );
      if (recent) continue;
      const key = `${target.userId}:${event.creatorId}`;
      const current = grouped.get(key) ?? {
        userId: target.userId,
        phone: target.phone,
        creatorId: event.creatorId,
        fanKeys: [],
        eventIds: [],
        body: "",
      };
      if (current.fanKeys.includes(fanKey)) continue;
      if (current.fanKeys.length >= 5) continue;
      current.fanKeys.push(fanKey);
      current.eventIds.push(event.id);
      const line = `${event.fanName ?? fanKey}: ${event.excerpt}`;
      current.body = current.body
        ? `${current.body}\n${line}`
        : `OnlyFans · ${event.creatorName}\n${line}`;
      grouped.set(key, current);
    }
  }
  return [...grouped.values()];
}
