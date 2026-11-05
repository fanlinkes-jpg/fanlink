import { useCallback, useEffect, useState } from "react";
import {
  checkCreatorSession,
  connectCreatorSession,
  listCreatorSessions,
  type ConnectCreatorInput,
  type CreatorSessionView,
} from "@/lib/of-sessions";

export function useCreatorSessions() {
  const [sessions, setSessions] = useState<CreatorSessionView[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await listCreatorSessions();
      setSessions(rows);
      setError(null);
    } catch (err) {
      setError(sessionErrorText(err));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void refresh();
    };
    run();
    const timer = setInterval(run, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh]);

  const check = useCallback(
    async (creatorId: string) => {
      try {
        const view = await checkCreatorSession({ data: { creatorId } });
        await refresh();
        return view;
      } catch (err) {
        setError(sessionErrorText(err));
        return null;
      }
    },
    [refresh],
  );

  const connect = useCallback(
    async (input: ConnectCreatorInput) => {
      const view = await connectCreatorSession({ data: input });
      await refresh();
      return view;
    },
    [refresh],
  );

  const byCreator = new Map(
    sessions.map((session) => [session.creatorId, session]),
  );
  return { sessions, byCreator, ready, error, refresh, connect, check };
}

export function sessionErrorText(error: unknown): string {
  const message = readMessage(error);
  if (message === "Unauthorized" || message.includes("Unauthorized")) {
    return "Inicia sesión en Fanlink para ver las sesiones de OnlyFans. Esa entrada es del equipo, no la contraseña de la cuenta.";
  }
  if (message.trim()) return message;
  return "No se ha podido leer el estado de la sesión";
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "";
}
