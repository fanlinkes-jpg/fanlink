import { useEffect } from "react";
import { useCrm } from "@/lib/crm";
import { loadWorkspace, saveWorkspace, snapshot, type SharedSlice } from "@/lib/workspace";

const LEGACY_KEY = "fanlink-management-v2";

function readLegacy(): SharedSlice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: SharedSlice };
    if (!parsed.state || !Array.isArray(parsed.state.creators)) return null;
    return parsed.state;
  } catch {
    return null;
  }
}

function dropLegacy(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LEGACY_KEY);
}

/**
 * El servidor es la copia compartida. localStorage solo se importa una vez
 * si el servidor aún no tiene fila, y después se borra.
 */
export function SessionSync() {
  useEffect(() => {
    let stop = false;
    let applying = false;
    let ready = false;
    let known = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pull() {
      let remote: Awaited<ReturnType<typeof loadWorkspace>>;
      try {
        remote = await loadWorkspace();
      } catch (error) {
        if (!stop) {
          const raw = error instanceof Error ? error.message : "";
          const offline = raw === "Failed to fetch" || raw === "Load failed";
          const current = useCrm.getState().teamAccess;
          useCrm.setState({
            workspaceReady: true,
            workspaceNotice: offline
              ? "El servidor no responde. Espera unos segundos o vuelve a arrancar npm run dev."
              : (raw || "No se ha podido leer la base compartida."),
            ...(current?.userId ? {} : {
              teamAccess: {
                userId: "",
                role: "member",
                perms: [],
                creatorIds: [],
                displayName: "Sin sesión",
                devMode: false,
              },
            }),
          });
        }
        return;
      }
      if (stop) return;
      useCrm.setState({ teamAccess: remote.access });
      if (!remote.state || remote.version === 0) {
        const legacy = readLegacy();
        dropLegacy();
        if (legacy && known === 0) {
          useCrm.setState(legacy);
          const saved = await saveWorkspace({ data: { state: snapshot(useCrm.getState()), expectedVersion: 0 } });
          if (stop) return;
          if (saved.ok) known = saved.version;
          else if (saved.reason === "conflict" && saved.state) {
            useCrm.setState(saved.state);
            known = saved.version;
          }
        }
        applying = true;
        useCrm.setState({ workspaceReady: true, teamAccess: remote.access });
        applying = false;
        ready = true;
        return;
      }
      dropLegacy();
      if (remote.version === known && ready) return;
      applying = true;
      useCrm.setState({
        ...remote.state,
        workspaceReady: true,
        teamAccess: remote.access,
        workspaceNotice: null,
      });
      known = remote.version;
      applying = false;
      ready = true;
    }

    void pull();
    const unsub = useCrm.subscribe(() => {
      if (!ready || applying) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const expectedVersion = known;
        void saveWorkspace({ data: { state: snapshot(useCrm.getState()), expectedVersion } })
          .then((saved) => {
            if (stop) return;
            if (saved.ok) {
              known = saved.version;
              return;
            }
            if (saved.reason === "conflict" && saved.state) {
              applying = true;
              useCrm.setState({
                ...saved.state,
                workspaceNotice: "Otra sesión guardó antes. Se muestra la copia del servidor.",
              });
              known = saved.version;
              applying = false;
              return;
            }
            if (saved.reason === "forbidden") {
              useCrm.setState({ workspaceNotice: saved.message });
              void pull();
            }
          })
          .catch(() => undefined);
      }, 700);
    });
    const poll = setInterval(() => void pull(), 4000);
    return () => {
      stop = true;
      unsub();
      clearInterval(poll);
      clearTimeout(timer);
    };
  }, []);

  return null;
}
