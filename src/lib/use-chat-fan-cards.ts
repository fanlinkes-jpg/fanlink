import { useCallback, useEffect, useState } from "react";
import { listChatFanCards } from "@/lib/of-sessions";
import { sessionErrorText } from "@/lib/use-creator-sessions";
import type { ChatFanCard } from "@/lib/chat-fan-cards";

export function useChatFanCards() {
  const [fans, setFans] = useState<ChatFanCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await listChatFanCards();
      setFans(result.fans);
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

  return { fans, error, refresh };
}
