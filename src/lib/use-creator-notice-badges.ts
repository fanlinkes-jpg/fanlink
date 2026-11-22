import { useEffect, useState } from "react";
import { listCreatorNoticeBadges } from "@/lib/of-notifications";

/** No leídas de notificaciones, solo de las creadoras que se piden. */
export function useCreatorNoticeBadges(creatorIds: readonly string[]): Record<string, number> {
  const key = creatorIds.filter((id) => id && id !== "all").join("\0");
  const [badges, setBadges] = useState<Record<string, number>>({});
  useEffect(() => {
    const ids = key ? key.split("\0") : [];
    if (ids.length === 0) {
      setBadges({});
      return;
    }
    let stop = false;
    const pull = () => {
      void listCreatorNoticeBadges({ data: { creatorIds: ids } }).then((result) => {
        if (stop) return;
        const next: Record<string, number> = {};
        for (const row of result.badges) {
          if (row.unread != null && row.unread > 0) next[row.creatorId] = row.unread;
        }
        setBadges(next);
      }).catch(() => {
        if (!stop) setBadges({});
      });
    };
    pull();
    const timer = window.setInterval(pull, 20_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [key]);
  return badges;
}
