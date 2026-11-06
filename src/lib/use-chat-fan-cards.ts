import { useCallback, useEffect, useState } from "react";
import { listChatFanCards } from "@/lib/of-sessions";
import { sessionErrorText } from "@/lib/use-creator-sessions";
import { fanThreadsForCards, type ChatFanCard } from "@/lib/chat-fan-cards";

/** Pide solo los hilos visibles. Si la lista no cambia, la petición sigue siendo esa lista. */
export function useChatFanCards(threads: ReadonlyArray<{ creatorId: string; fanKey: string | null }>) {
  const [fans, setFans] = useState<ChatFanCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requested = fanThreadsForCards(threads);
  const signature = requested.map((thread) => `${thread.creatorId}\u001f${thread.fanKey}`).join("\u001e");

  const refresh = useCallback(async () => {
    if (!signature) {
      setFans([]);
      setError(null);
      return;
    }
    const current = signature.split("\u001e").flatMap((item) => {
      const [creatorId, fanKey] = item.split("\u001f");
      if (!creatorId || !fanKey) return [];
      return [{ creatorId, fanKey }];
    });
    try {
      const result = await listChatFanCards({ data: { threads: current } });
      setFans(result.fans);
      setError(null);
    } catch (err) {
      setError(sessionErrorText(err));
    }
  }, [signature]);

  useEffect(() => {
    void refresh();
    if (!signature) return;
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh, signature]);

  return { fans, error, refresh };
}
