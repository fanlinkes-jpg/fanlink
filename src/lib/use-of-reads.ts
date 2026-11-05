import { useCallback, useEffect, useState } from "react";
import { listCreatorReads, setSyncInterval, syncCreatorRead, type CreatorReadView } from "@/lib/of-sessions";
import { sessionErrorText } from "@/lib/use-creator-sessions";

export function useOfReads() {
  const [creators, setCreators] = useState<CreatorReadView[]>([]);
  const [role, setRole] = useState<"owner" | "member" | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [intervalMin, setIntervalMin] = useState(30);
  const [chatIntervalMin, setChatIntervalMin] = useState(2);
  const [runningCreatorIds, setRunningCreatorIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await listCreatorReads();
      setCreators(result.creators);
      setRole(result.role);
      setIntervalMin(result.intervalMin);
      setChatIntervalMin(result.chatIntervalMin);
      setRunningCreatorIds(result.runningCreatorIds);
      setError(null);
    } catch (err) {
      setError(sessionErrorText(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const saveInterval = useCallback(async (minutes: number, chatMinutes: number) => {
    const saved = await setSyncInterval({ data: { minutes, chatMinutes } });
    setIntervalMin(saved.intervalMin);
    setChatIntervalMin(saved.chatIntervalMin);
  }, []);

  const sync = useCallback(
    async (creatorId: string) => {
      setPendingId(creatorId);
      setError(null);
      try {
        await syncCreatorRead({ data: { creatorId } });
        await refresh();
      } catch (err) {
        setError(sessionErrorText(err));
      } finally {
        setPendingId(null);
      }
    },
    [refresh],
  );

  const byCreator = new Map(creators.map((creator) => [creator.creatorId, creator]));
  return { creators, byCreator, role, pendingId, intervalMin, chatIntervalMin, runningCreatorIds, error, refresh, sync, saveInterval };
}
