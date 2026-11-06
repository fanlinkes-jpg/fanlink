export type SegmentFan = {
  fanKey: string;
  name: string | null;
  status: "active" | "expired";
  spentCents: number | null;
  lastInteractionAt: string | null;
  renewAuto?: boolean | null;
  subscribedAt?: string | null;
};

export type SegmentKind = "active" | "expired" | "spent" | "quiet" | "whale" | "risk" | "asleep" | "new";

export const SEGMENT_KINDS: SegmentKind[] = ["active", "expired", "spent", "quiet", "whale", "risk", "asleep", "new"];

const SPEND_SEGMENTS = new Set<SegmentKind>(["spent", "whale"]);

export function memberMayUseSegment(role: "owner" | "member", segment: SegmentKind): boolean {
  if (role === "owner") return true;
  return !SPEND_SEGMENTS.has(segment);
}

export function fansInSegment(
  fans: SegmentFan[],
  segment: SegmentKind,
  options: { minSpentCents: number; quietDays: number; now: Date; whaleCents?: number },
): SegmentFan[] {
  const quietBefore = options.now.getTime() - options.quietDays * 24 * 60 * 60 * 1000;
  const whaleCents = options.whaleCents ?? 10_000;
  return fans.filter((fan) => {
    switch (segment) {
      case "active":
        return fan.status === "active";
      case "expired":
        return fan.status === "expired";
      case "spent":
        return fan.spentCents != null && fan.spentCents >= options.minSpentCents;
      case "quiet": {
        if (fan.status !== "active") return false;
        if (!fan.lastInteractionAt) return true;
        return Date.parse(fan.lastInteractionAt) < quietBefore;
      }
      case "whale":
        return fan.spentCents != null && fan.spentCents >= whaleCents;
      case "risk":
        return fan.renewAuto === false || (fan.status === "active" && olderThan(fan.lastInteractionAt, options.now, 14));
      case "asleep":
        return fan.status === "active" && !isNewFan(fan, options.now) && olderThan(fan.lastInteractionAt, options.now, 30);
      case "new":
        return isNewFan(fan, options.now);
      default: {
        const exhaustive: never = segment;
        return exhaustive;
      }
    }
  });
}

function olderThan(iso: string | null | undefined, now: Date, days: number): boolean {
  if (!iso) return true;
  return Date.parse(iso) < now.getTime() - days * 86_400_000;
}

function isNewFan(fan: SegmentFan, now: Date): boolean {
  if (!fan.subscribedAt) return false;
  return Date.parse(fan.subscribedAt) >= now.getTime() - 14 * 86_400_000;
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
