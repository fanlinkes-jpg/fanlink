import { useEffect, useState } from "react";
import { CreatorColumn } from "@/components/creator-tabs";
import { useCrm } from "@/lib/crm";
import { creatorChipBadges, readInboxCreator, resolveInboxCreator, writeInboxCreator } from "@/lib/inbox-scope";
import { listCreatorChats } from "@/lib/of-sessions";
import { useCreatorNoticeBadges } from "@/lib/use-creator-notice-badges";
import { useCreatorSessions } from "@/lib/use-creator-sessions";

/** La columna de creadoras, la misma en Operativa, Mensajes y Funciones. */
export function CreatorRail() {
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const setCreator = useCrm((s) => s.setCreator);
  const { sessions } = useCreatorSessions();
  const avatars = Object.fromEntries(sessions.map((session) => [session.creatorId, session.avatarUrl]));
  const ids = creators.map((creator) => creator.id);
  const creatorKey = ids.filter((id) => id && id !== "all").join("\0");
  const noticeBadges = useCreatorNoticeBadges(ids);
  const [threads, setThreads] = useState<Array<{ creatorId: string; unread: number | null }>>([]);
  useEffect(() => {
    let stop = false;
    const pull = () => {
      void listCreatorChats().then((list) => {
        if (!stop) setThreads(list.threads.map((thread) => ({ creatorId: thread.creatorId, unread: thread.unread })));
      }).catch(() => {
        if (!stop) setThreads([]);
      });
    };
    pull();
    const timer = window.setInterval(pull, 20_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [creatorKey]);
  const remembered = typeof window === "undefined" ? null : readInboxCreator(window.localStorage);
  const selected = resolveInboxCreator({ requested: creatorId, creators, remembered }) ?? "";
  const badges = creatorChipBadges({
    threads,
    notices: Object.entries(noticeBadges).map(([id, unread]) => ({ creatorId: id, unread })),
    visibleIds: ids,
  });
  return (
    <CreatorColumn
      creators={creators}
      creatorId={selected}
      avatars={avatars}
      badges={badges}
      onSelect={(id) => {
        writeInboxCreator(window.localStorage, id);
        setCreator(id);
      }}
    />
  );
}
