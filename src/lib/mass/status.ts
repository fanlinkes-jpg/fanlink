import type { MassStatus } from "./types.ts";

const NEXT: Record<MassStatus, readonly MassStatus[]> = {
  draft: ["scheduled", "held", "cancelled"],
  scheduled: ["sent", "cancelled", "retry"],
  held: ["draft", "cancelled"],
  retry: ["scheduled", "sent", "cancelled"],
  sent: [],
  cancelled: [],
};

export function canTransitionMass(from: MassStatus, to: MassStatus): boolean {
  return NEXT[from].includes(to);
}
