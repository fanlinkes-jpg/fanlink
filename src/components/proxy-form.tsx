import { useState } from "react";
import { setCreatorProxy } from "@/lib/of-sessions";

export function ProxyForm({ creatorId, label, onSaved }: { creatorId: string; label: string | null; onSaved: () => void }) {
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form
      className="mt-1 grid gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void setCreatorProxy({ data: { creatorId, proxy: server.trim() ? { server, username, password } : null } })
          .then(() => {
            setPassword("");
            onSaved();
          })
          .catch(() => undefined);
      }}
    >
      <span className="text-[#6d7585]">{label ? `Proxy ${label}` : "Sin proxy"}</span>
      <input value={server} onChange={(event) => setServer(event.target.value)} placeholder="http://host:puerto" className="h-7 rounded border border-[#e6e8ee] px-1" />
      <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="usuario" className="h-7 rounded border border-[#e6e8ee] px-1" />
      <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="contraseña" type="password" className="h-7 rounded border border-[#e6e8ee] px-1" />
      <button type="submit" className="rounded border border-[#e6e8ee] px-1 py-1 text-left">Guardar proxy</button>
    </form>
  );
}
