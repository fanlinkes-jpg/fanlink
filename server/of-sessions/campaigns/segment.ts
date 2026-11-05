export type SegmentFan = {
  fanKey: string;
  name: string | null;
  status: "active" | "expired";
  spentCents: number | null;
  lastInteractionAt: string | null;
};

export type SegmentKind = "active" | "expired" | "spent" | "quiet";

export function fansInSegment(
  fans: SegmentFan[],
  segment: SegmentKind,
  options: { minSpentCents: number; quietDays: number; now: Date },
): SegmentFan[] {
  const quietBefore = options.now.getTime() - options.quietDays * 24 * 60 * 60 * 1000;
  return fans.filter((fan) => {
    switch (segment) {
      case "active":
        return fan.status === "active";
      case "expired":
        return fan.status === "expired";
      case "spent":
        return (fan.spentCents ?? 0) >= options.minSpentCents;
      case "quiet": {
        if (fan.status !== "active") return false;
        if (!fan.lastInteractionAt) return true;
        return Date.parse(fan.lastInteractionAt) < quietBefore;
      }
      default: {
        const exhaustive: never = segment;
        return exhaustive;
      }
    }
  });
}

export function previewBody(body: string, name: string): string {
  return body.replaceAll("{nombre}", name || "fan");
}

export function sendGate(flag: string | undefined, hostname: string): { allowed: boolean; reason: string } {
  if (flag !== "true") return { allowed: false, reason: "Envío real desactivado" };
  const host = hostname.toLowerCase();
  if (host === "onlyfans.com" || host.endsWith(".onlyfans.com")) {
    return { allowed: false, reason: "No se envía a OnlyFans real." };
  }
  return { allowed: true, reason: "" };
}
