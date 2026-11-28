import { useEffect, useState } from "react";
import { chatUnreadTotal } from "@/lib/inbox-scope";
import { listCreatorChats } from "@/lib/of-sessions";

/**
 * Chats sin leer de las creadoras que se piden, para el icono de Mensajes del menú. Lee lo ya sincronizado
 * en el CRM (el mismo `listCreatorChats` de la columna de creadoras): no llama a OnlyFans.
 */
export function useChatUnreadTotal(creatorIds: readonly string[], enabled = true): number {
  const key = creatorIds.filter((id) => id && id !== "all").join("\0");
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const ids = key ? key.split("\0") : [];
    if (!enabled || ids.length === 0) {
      setTotal(0);
      return;
    }
    let stop = false;
    const pull = () => {
      void listCreatorChats().then((list) => {
        if (stop) return;
        setTotal(chatUnreadTotal({
          threads: list.threads.map((thread) => ({ creatorId: thread.creatorId, unread: thread.unread })),
          visibleIds: ids,
          ofChats: list.ofChatUnread ?? [],
        }));
      }).catch(() => {
        if (!stop) setTotal(0);
      });
    };
    pull();
    const timer = window.setInterval(pull, 20_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [key, enabled]);
  return total;
}
