import { useEffect } from "react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { useCrm } from "@/lib/crm";
import { adoptStaffDisplayName, loadWorkspace, saveWorkspace, snapshot, type SharedSlice } from "@/lib/workspace";
import { createWorkspaceSaver } from "@/lib/workspace-sync";

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
const PLACEHOLDER_NAMES = new Set(["Operador local", "Miembro"]);

export function SessionSync() {
  const user = useCurrentUser();
  const storedName = useCrm((state) => state.teamAccess?.displayName ?? null);
  useEffect(() => {
    const name = user?.displayName?.trim() ?? "";
    if (!name || !storedName || !PLACEHOLDER_NAMES.has(storedName) || name === storedName) return;
    let stop = false;
    void adoptStaffDisplayName({ data: { displayName: name } }).then((result) => {
      if (stop) return;
      const access = useCrm.getState().teamAccess;
      if (!access) return;
      useCrm.setState({ teamAccess: { ...access, displayName: result.displayName } });
    }).catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [storedName, user?.displayName]);
  useEffect(() => {
    let stop = false;
    let applying = false;
    let ready = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saver = createWorkspaceSaver({
      save: (input) => saveWorkspace({ data: { state: input.state as SharedSlice, expectedVersion: input.expectedVersion } }),
      userId: () => {
        const id = useCrm.getState().teamAccess?.userId ?? "";
        return id || null;
      },
      apply: (state, version, notice) => {
        applying = true;
        useCrm.setState({
          ...(state as SharedSlice),
          workspaceNotice: notice,
          workspaceReady: true,
        });
        saver.reset(version, state);
        applying = false;
      },
      notice: (message) => {
        useCrm.setState({ workspaceNotice: message });
      },
      forbid: (message) => {
        useCrm.setState({ workspaceNotice: message });
        void pull();
      },
    });

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
        if (legacy && saver.knownVersion() === 0) {
          useCrm.setState(legacy);
          const saved = await saveWorkspace({ data: { state: snapshot(useCrm.getState()), expectedVersion: 0 } });
          if (stop) return;
          if (saved.ok) saver.reset(saved.version, snapshot(useCrm.getState()));
          else if (saved.reason === "conflict" && saved.state) {
            useCrm.setState(saved.state);
            saver.reset(saved.version, saved.state);
          }
        }
        applying = true;
        useCrm.setState({ workspaceReady: true, teamAccess: remote.access });
        applying = false;
        ready = true;
        return;
      }
      dropLegacy();
      if (remote.version === saver.knownVersion() && ready) return;
      applying = true;
      useCrm.setState({
        ...remote.state,
        workspaceReady: true,
        teamAccess: remote.access,
        workspaceNotice: null,
      });
      saver.reset(remote.version, remote.state);
      applying = false;
      ready = true;
    }

    void pull();
    const unsub = useCrm.subscribe(() => {
      if (!ready || applying) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (stop || applying) return;
        saver.push(snapshot(useCrm.getState()));
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
