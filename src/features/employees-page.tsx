import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MoreHorizontal, Plus, X } from "lucide-react";
import { Badge, Button, Field, Select } from "@/components/ui";
import { useCrm } from "@/lib/crm";
import {
  deleteEmployee,
  editEmployee,
  inviteEmployee,
  listEmployees,
  resendEmployeeInvite,
  setEmployeeActive,
  type EmployeeRow,
  type InviteDelivery,
} from "@/lib/employees";
import { INVITABLE_LEVELS, LEVEL_LABELS, type EmployeeStatus } from "@/lib/staff-levels";
import { initialOf } from "@/lib/initial";

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: "Activado",
  disabled: "Desactivado",
  invited: "Invitado",
};

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "No se ha podido completar la acción.";
}

function mailNote(delivery: InviteDelivery): string {
  if (delivery.mail.sent) return `Correo enviado a ${delivery.email}.`;
  if (delivery.mail.reason === "provider-error") return "El proveedor de correo ha fallado. Copia el enlace y envíaselo a mano.";
  return "El correo no está configurado todavía. Copia el enlace y envíaselo a mano.";
}

export function EmployeesPage() {
  const creators = useCrm((state) => state.creators);
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [who, setWho] = useState("todos");
  const [creator, setCreator] = useState("todas");
  const [status, setStatus] = useState("todos");
  const [editing, setEditing] = useState<EmployeeRow | "new" | null>(null);
  const [delivery, setDelivery] = useState<InviteDelivery | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await listEmployees();
      setRows(result.rows);
      setAllowed(result.allowed);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const creatorName = useMemo(() => new Map(creators.map((item) => [item.id, item.name])), [creators]);
  const visible = rows.filter((row) => {
    if (who !== "todos" && row.id !== who) return false;
    if (creator !== "todas" && !row.creatorIds.includes(creator)) return false;
    if (status !== "todos" && row.status !== status) return false;
    return true;
  });

  async function act(label: string, run: () => Promise<unknown>) {
    setMenu(null);
    try {
      await run();
      toast.success(label);
      await reload();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function resend(row: EmployeeRow) {
    setMenu(null);
    try {
      const result = await resendEmployeeInvite({ data: { id: row.id } });
      setDelivery(result);
      toast.success(result.mail.sent ? `Invitación reenviada a ${result.email}` : "Invitación renovada");
      await reload();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function remove(row: EmployeeRow) {
    setMenu(null);
    const text = row.kind === "invite"
      ? `¿Cancelar la invitación de ${row.name}?`
      : `¿Eliminar a ${row.name}? Sus mensajes enviados se quedan con su nombre.`;
    if (!window.confirm(text)) return;
    await act(row.kind === "invite" ? "Invitación cancelada" : "Empleado eliminado", () => deleteEmployee({ data: { id: row.id, kind: row.kind } }));
  }

  if (!allowed) {
    return (
      <div className="p-4 md:p-6">
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">Solo la dueña gestiona a los empleados.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6" data-testid="employees-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Select value={who} onChange={(event) => setWho(event.target.value)} aria-label="Filtrar por empleado">
            <option value="todos">Todos los empleados</option>
            {rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </Select>
          <Select value={creator} onChange={(event) => setCreator(event.target.value)} aria-label="Filtrar por creadora">
            <option value="todas">Todas las creadoras</option>
            {creators.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
          <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por estado">
            <option value="todos">Todos los estados</option>
            {(Object.keys(STATUS_LABEL) as EmployeeStatus[]).map((key) => <option key={key} value={key}>{STATUS_LABEL[key]}</option>)}
          </Select>
        </div>
        <Button onClick={() => { setDelivery(null); setEditing("new"); }} aria-label="Añadir empleado">
          <Plus className="h-4 w-4" aria-hidden /> Añadir empleado
        </Button>
      </div>

      {loadError && <p role="alert" className="rounded-lg border border-line bg-surface p-3 text-sm text-danger">{loadError}</p>}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[820px] text-left text-sm" data-testid="employees-table">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              {["Empleado", "Creadoras asignadas", "Rol", "Estado", "Acciones"].map((header) => (
                <th key={header} className="px-3 py-2 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">Cargando…</td></tr>}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No hay empleados con estos filtros.</td></tr>
            )}
            {visible.map((row) => (
              <tr key={`${row.kind}-${row.id}`} className="border-t border-line align-middle" data-testid="employee-row" data-employee={row.name}>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-raised text-xs font-semibold">{initialOf(row.name)}</span>
                    <div>
                      <p className="font-medium">{row.name}</p>
                      {row.email && <p className="text-xs text-muted">{row.email}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  {row.level === "owner" ? (
                    <span className="text-xs text-muted">Todas</span>
                  ) : row.creatorIds.length === 0 ? (
                    <span className="text-xs text-muted">Sin creadoras</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {row.creatorIds.map((id) => <Badge key={id}>{creatorName.get(id) ?? id}</Badge>)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3">{LEVEL_LABELS[row.level]}</td>
                <td className="px-3 py-3">
                  <Badge tone={row.status === "active" ? "primary" : row.status === "invited" ? "gold" : "muted"}>
                    {STATUS_LABEL[row.status]}
                  </Badge>
                  {row.status === "invited" && row.expired && <p className="mt-1 text-xs text-danger">Caducada</p>}
                </td>
                <td className="px-3 py-3">
                  {row.level === "owner" ? (
                    <span className="text-xs text-muted">—</span>
                  ) : (
                    <div className="relative flex items-center gap-1">
                      <Button variant="soft" onClick={() => { setDelivery(null); setEditing(row); }} aria-label={`Editar ${row.name}`}>Editar</Button>
                      <Button variant="ghost" onClick={() => setMenu(menu === row.id ? null : row.id)} aria-label={`Más acciones de ${row.name}`} aria-expanded={menu === row.id}>
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </Button>
                      {menu === row.id && (
                        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-line bg-surface p-1 shadow-lg">
                          {row.kind === "invite" && (
                            <MenuItem onClick={() => void resend(row)}>Reenviar invitación</MenuItem>
                          )}
                          {row.kind === "member" && row.status === "active" && (
                            <MenuItem onClick={() => void act("Empleado desactivado", () => setEmployeeActive({ data: { id: row.id, active: false } }))}>Desactivar</MenuItem>
                          )}
                          {row.kind === "member" && row.status === "disabled" && (
                            <MenuItem onClick={() => void act("Empleado activado", () => setEmployeeActive({ data: { id: row.id, active: true } }))}>Activar</MenuItem>
                          )}
                          <MenuItem danger onClick={() => void remove(row)}>{row.kind === "invite" ? "Cancelar invitación" : "Eliminar"}</MenuItem>
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EmployeeDialog
          target={editing}
          creators={creators.map((item) => ({ id: item.id, name: item.name }))}
          delivery={delivery}
          onClose={() => { setEditing(null); setDelivery(null); void reload(); }}
          onDelivery={(value) => { setDelivery(value); void reload(); }}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
      {!editing && delivery && <DeliveryDialog delivery={delivery} onClose={() => setDelivery(null)} />}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full rounded px-3 py-2 text-left text-sm hover:bg-raised ${danger ? "text-danger" : ""}`}
    >
      {children}
    </button>
  );
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-muted hover:bg-raised">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DeliveryPanel({ delivery }: { delivery: InviteDelivery }) {
  return (
    <div className="space-y-2" data-testid="invite-delivery">
      <p className="text-sm">{mailNote(delivery)}</p>
      <p className="text-xs text-muted">El enlace es de un solo uso y caduca en 7 días.</p>
      <div className="flex gap-2">
        <Field readOnly value={delivery.link} aria-label="Enlace de invitación" data-testid="invite-link" onFocus={(event) => event.currentTarget.select()} />
        <Button
          variant="soft"
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(delivery.link).then(
              () => toast.success("Enlace copiado"),
              () => toast.error("Selecciona el enlace y cópialo a mano"),
            );
          }}
        >
          Copiar
        </Button>
      </div>
    </div>
  );
}

function DeliveryDialog({ delivery, onClose }: { delivery: InviteDelivery; onClose: () => void }) {
  return (
    <Shell title="Invitación" onClose={onClose}>
      <DeliveryPanel delivery={delivery} />
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>Listo</Button></div>
    </Shell>
  );
}

function EmployeeDialog({
  target,
  creators,
  delivery,
  onClose,
  onDelivery,
  onSaved,
}: {
  target: EmployeeRow | "new";
  creators: Array<{ id: string; name: string }>;
  delivery: InviteDelivery | null;
  onClose: () => void;
  onDelivery: (delivery: InviteDelivery) => void;
  onSaved: () => void;
}) {
  const row = target === "new" ? null : target;
  const [name, setName] = useState(row?.name ?? "");
  const [email, setEmail] = useState(row?.email ?? "");
  const [level, setLevel] = useState<string>(row && row.level !== "owner" ? row.level : "chatter");
  const [picked, setPicked] = useState<string[]>(row?.creatorIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (row) {
        await editEmployee({ data: { id: row.id, kind: row.kind, name, level, creatorIds: picked } });
        toast.success("Cambios guardados");
        onSaved();
      } else {
        const result = await inviteEmployee({ data: { name, email, level, creatorIds: picked } });
        onDelivery(result);
        toast.success(result.mail.sent ? `Invitación enviada a ${result.email}` : "Invitación creada");
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (delivery && !row) {
    return (
      <Shell title="Invitación creada" onClose={onClose}>
        <DeliveryPanel delivery={delivery} />
        <div className="mt-4 flex justify-end"><Button onClick={onClose}>Listo</Button></div>
      </Shell>
    );
  }

  return (
    <Shell title={row ? "Editar empleado" : "Añadir empleado"} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nombre*</span>
          <Field value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} aria-label="Nombre" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Correo*</span>
          <Field
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={Boolean(row)}
            aria-label="Correo"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Rol*</span>
          <Select className="w-full" value={level} onChange={(event) => setLevel(event.target.value)} aria-label="Rol">
            {INVITABLE_LEVELS.map((item) => <option key={item} value={item}>{LEVEL_LABELS[item]}</option>)}
          </Select>
        </label>
        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">Asignar creadoras</legend>
          {creators.length === 0 ? (
            <p className="text-xs text-muted">Todavía no hay creadoras.</p>
          ) : (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-line p-2">
              {creators.map((item) => (
                <label key={item.id} className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={picked.includes(item.id)} onChange={() => toggle(item.id)} />
                  {item.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy}>{row ? "Guardar" : "Guardar e invitar"}</Button>
        </div>
      </form>
    </Shell>
  );
}
