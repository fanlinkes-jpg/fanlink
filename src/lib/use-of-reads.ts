import { useCallback, useEffect, useState } from "react";
import { listCreatorReads, syncCreatorRead, type CreatorReadView } from "@/lib/of-sessions";
import { sessionErrorText } from "@/lib/use-creator-sessions";

export function useOfReads() {
  const [creators, setCreators] = useState<CreatorReadView[]>([]);
  const [role, setRole] = useState<"owner" | "member" | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await listCreatorReads();
      setCreators(result.creators);
      setRole(result.role);
      setError(null);
    } catch (err) {
      setError(sessionErrorText(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
  return { creators, byCreator, role, pendingId, error, refresh, sync };
}
