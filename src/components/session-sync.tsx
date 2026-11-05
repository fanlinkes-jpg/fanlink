import { useEffect } from "react";
import { useCrm } from "@/lib/crm";
import { loadWorkspace, saveWorkspace, snapshot } from "@/lib/workspace";

export function SessionSync() {
  useEffect(() => {
    let stop = false;
    let applying = false;
    let known = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pull() {
      let remote: Awaited<ReturnType<typeof loadWorkspace>>;
      try {
        remote = await loadWorkspace();
      } catch {
        return;
      }
      if (stop) return;
      if (!remote.state || remote.version === 0) {
        if (known === -1) {
          try {
            const saved = await saveWorkspace({ data: { state: snapshot(useCrm.getState()) } });
            known = saved.version;
          } catch {
            known = 0;
          }
        }
        return;
      }
      if (remote.version === known) return;
      applying = true;
      useCrm.setState(remote.state);
      known = remote.version;
      applying = false;
    }

    void pull();
    const unsub = useCrm.subscribe(() => {
      if (applying) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void saveWorkspace({ data: { state: snapshot(useCrm.getState()) } })
          .then((saved) => {
            if (!stop) known = saved.version;
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
