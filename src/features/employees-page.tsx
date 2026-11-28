import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Plus, X } from "lucide-react";
import { Button, Field, Select } from "@/components/ui";
import { StaffCard, TABLE_CLASS, TD_CLASS, THEAD_CLASS, TH_CLASS, TR_CLASS } from "@/components/staff-card";
import { useCrm } from "@/lib/crm";
import {
  deleteEmployee,
  editEmployee,
  inviteEmployee,
  listEmployees,
  resendEmployeeInvite,
  resetEmployeePassword,
  setEmployeeActive,
  setEmployeeRoles,
  type EmployeeRow,
  type InviteDelivery,
} from "@/lib/employees";
import { INVITABLE_LEVELS, LEVEL_LABELS, lastSeenLabel, type EmployeeStatus, type StaffLevel } from "@/lib/staff-levels";
import { PERM_GROUPS, PERM_LABELS, describePerms, isPermLocked, presetPerms } from "@/lib/staff-roles";
import { initialOf } from "@/lib/initial";
import { updateStaffAlert } from "@/lib/workspace";
import { TeamExtras } from "@/features/control-pages";

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: "Activado",
  disabled: "Desactivado",
  invited: "Invitado",
};

const LINK = "text-[#1d9bf0] hover:underline";

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "No se ha podido completar la acción.";
}

function mailNote(delivery: InviteDelivery): string {
  if (delivery.mail.sent) return `Correo enviado a ${delivery.email}.`;
  if (delivery.mail.reason === "provider-error") return "El proveedor de correo ha fallado. Copia el enlace y envíaselo a mano.";
  return "El correo no está configurado todavía. Copia el enlace y envíaselo a mano.";
}

function rolesText(row: EmployeeRow): string {
  return row.roles.map((role) => LEVEL_LABELS[role]).join(", ");
}

function creatorLabel(creator: { name: string; handle?: string }): string {
  const handle = creator.handle?.replace(/^@/, "").trim();
  return handle ? `${creator.name} - ${handle}` : creator.name;
}

type CreatorOption = { id: string; name: string; handle?: string };

export function EmployeesPage() {
  const rawCreators = useCrm((state) => state.creators);
  const agency = useCrm((state) => state.agency);
  const creators: CreatorOption[] = useMemo(() => rawCreators.map((item) => ({ id: item.id, name: item.name, handle: item.handle })), [rawCreators]);
  const groupName = (agency?.trim() || "Fanlink Management").toUpperCase();
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Los filtros se aplican al escribir o elegir, sin pulsar Buscar.
  const [whoDraft, setWhoDraft] = useState("");
  const [creatorDraft, setCreatorDraft] = useState("todas");
  const [statusDraft, setStatusDraft] = useState("todos");
  const filters = { who: whoDraft, creator: creatorDraft, status: statusDraft };
  const [editing, setEditing] = useState<EmployeeRow | "new" | null>(null);
  const [delivery, setDelivery] = useState<InviteDelivery | null>(null);
  const [resetDelivery, setResetDelivery] = useState<InviteDelivery | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [groupMenu, setGroupMenu] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkRoles, setBulkRoles] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const ensureEmployees = useCrm((state) => state.ensureEmployees);

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

  // Turnos y Métricas salen de las personas reales de esta tabla.
  const people = useMemo(
    () => rows.filter((row) => row.kind === "member").map((row) => ({ id: row.id, name: row.name, roleLabel: rolesText(row), owner: row.level === "owner", onlyChatter: row.roles.every((role) => role === "chatter") })),
    [rows],
  );
  useEffect(() => {
    if (people.length === 0) return;
    ensureEmployees(people.map((person) => ({ id: person.id, name: person.name, role: person.owner ? "Dueña" : person.onlyChatter ? "Chatter" : "Manager" })));
  }, [people, ensureEmployees]);

  useEffect(() => {
    if (!menu && !groupMenu) return;
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-menu-root]")) {
        setMenu(null);
        setGroupMenu(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu, groupMenu]);

  const creatorName = useMemo(() => new Map(creators.map((item) => [item.id, item.name])), [creators]);
  const visible = rows.filter((row) => {
    const text = filters.who.trim().toLowerCase();
    if (text && !`${row.name} ${row.email ?? ""}`.toLowerCase().includes(text)) return false;
    if (filters.creator !== "todas" && !row.creatorIds.includes(filters.creator)) return false;
    if (filters.status !== "todos" && row.status !== filters.status) return false;
    return true;
  });
  const selectable = visible.filter((row) => row.level !== "owner");
  const keyOf = (row: EmployeeRow) => `${row.kind}:${row.id}`;
  const chosen = rows.filter((row) => picked.includes(keyOf(row)));
  const allPicked = selectable.length > 0 && selectable.every((row) => picked.includes(keyOf(row)));

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

  async function resetPassword(row: EmployeeRow) {
    setMenu(null);
    try {
      const result = await resetEmployeePassword({ data: { id: row.id } });
      setResetDelivery(result);
      toast.success(result.mail.sent ? `Correo de reseteo enviado a ${result.email}` : "Enlace de reseteo creado");
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function remove(row: EmployeeRow) {
    setMenu(null);
    const text = row.kind === "invite"
      ? `¿Borrar la invitación de ${row.name}?`
      : `¿Borrar a ${row.name}? Sus mensajes enviados se quedan con su nombre.`;
    if (!window.confirm(text)) return;
    await act(row.kind === "invite" ? "Invitación borrada" : "Empleado borrado", () => deleteEmployee({ data: { id: row.id, kind: row.kind } }));
  }

  async function removeChosen() {
    setGroupMenu(false);
    if (chosen.length === 0) return;
    if (!window.confirm(`¿Borrar a ${chosen.length} ${chosen.length === 1 ? "empleado" : "empleados"}? Sus mensajes enviados se quedan con su nombre.`)) return;
    let failed = 0;
    for (const row of chosen) {
      try {
        await deleteEmployee({ data: { id: row.id, kind: row.kind } });
      } catch {
        failed += 1;
      }
    }
    setPicked([]);
    if (failed > 0) toast.error(`${failed} no se han podido borrar.`);
    else toast.success("Empleados borrados");
    await reload();
  }

  function search(event?: React.FormEvent) {
    event?.preventDefault();
    document.querySelector("[data-testid='employees-table']")?.scrollIntoView({ block: "nearest" });
  }

  function clear() {
    setWhoDraft("");
    setCreatorDraft("todas");
    setStatusDraft("todos");
  }

  if (!allowed) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">Solo la dueña gestiona a los empleados.</p>
        <TeamExtras />
      </div>
    );
  }

  const none = chosen.length === 0;

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="employees-page">
      <StaffCard
        title={groupName}
        testId="employees-card"
        right={
          <>
            <div className="relative" data-menu-root ref={barRef}>
              <Button variant="soft" type="button" onClick={() => setGroupMenu((open) => !open)} aria-expanded={groupMenu} aria-haspopup="menu">
                Acciones en grupo <ChevronDown className="h-4 w-4" aria-hidden />
              </Button>
              {groupMenu && (
                <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-line bg-surface p-1 shadow-lg">
                  <MenuItem disabled title="Solo hay un grupo" onClick={() => undefined}>Editar grupo en grupo</MenuItem>
                  <MenuItem disabled={none} title={none ? "Marca a quien quieras" : undefined} onClick={() => { setGroupMenu(false); setBulkRoles(true); }}>Editar roles en grupo</MenuItem>
                  <MenuItem danger disabled={none} title={none ? "Marca a quien quieras" : undefined} onClick={() => void removeChosen()}>Eliminar en grupo</MenuItem>
                </div>
              )}
            </div>
            <Button className="bg-[#1d9bf0] hover:bg-[#1a8cd8]" onClick={() => { setDelivery(null); setEditing("new"); }} aria-label="Añadir empleado">
              <Plus className="h-4 w-4" aria-hidden /> Añadir empleado
            </Button>
          </>
        }
        filters={
          <form onSubmit={search} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3" data-testid="employee-filters">
            <label className="text-xs text-muted">
              Por empleado
              <Field value={whoDraft} onChange={(event) => setWhoDraft(event.target.value)} placeholder="Nombre o correo" aria-label="Por empleado" className="mt-1 block w-56" />
            </label>
            <label className="text-xs text-muted">
              Por creador
              <Select value={creatorDraft} onChange={(event) => setCreatorDraft(event.target.value)} aria-label="Por creador" className="mt-1 block w-52">
                <option value="todas">Todos</option>
                {creators.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </label>
            <label className="text-xs text-muted">
              Por estado
              <Select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)} aria-label="Por estado" className="mt-1 block w-44">
                <option value="todos">Todos</option>
                {(Object.keys(STATUS_LABEL) as EmployeeStatus[]).map((key) => <option key={key} value={key}>{STATUS_LABEL[key]}</option>)}
              </Select>
            </label>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="soft" onClick={clear}>Reestablecer</Button>
              <Button type="submit" className="bg-[#1d9bf0] hover:bg-[#1a8cd8]">Buscar</Button>
            </div>
          </form>
        }
      >
        {loadError && <p role="alert" className="border-b border-line p-3 text-sm text-danger">{loadError}</p>}
        <table className={TABLE_CLASS} data-testid="employees-table">
          <thead className={THEAD_CLASS}>
            <tr>
              <th className={`${TH_CLASS} w-10`}>
                <input
                  type="checkbox"
                  aria-label="Marcar todos"
                  className="h-4 w-4 accent-primary"
                  checked={allPicked}
                  onChange={() => setPicked(allPicked ? [] : selectable.map(keyOf))}
                />
              </th>
              {["Empleado", "Creadores asignados", "Rol", "Estado", "Última conexión", "Acciones"].map((header) => (
                <th key={header} className={TH_CLASS}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">Cargando…</td></tr>}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">No hay empleados con estos filtros.</td></tr>
            )}
            {visible.map((row) => {
              const isOwner = row.level === "owner";
              const grey = isOwner || row.status === "disabled";
              const edit = () => { setDelivery(null); setEditing(row); };
              return (
                <tr
                  key={keyOf(row)}
                  className={`${TR_CLASS} ${grey ? "bg-surface/60 text-muted" : ""}`}
                  data-testid="employee-row"
                  data-employee={row.name}
                  data-owner={isOwner ? "true" : undefined}
                  data-status={row.status}
                >
                  <td className={TD_CLASS}>
                    <input
                      type="checkbox"
                      aria-label={`Marcar a ${row.name}`}
                      className="h-4 w-4 accent-primary"
                      disabled={isOwner}
                      checked={picked.includes(keyOf(row))}
                      onChange={() => setPicked((list) => (list.includes(keyOf(row)) ? list.filter((item) => item !== keyOf(row)) : [...list, keyOf(row)]))}
                    />
                  </td>
                  <td className={TD_CLASS}>
                    <div className="flex items-center gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold">{initialOf(row.name)}</span>
                      <div className="min-w-0">
                        <p className={`font-medium ${grey ? "" : "text-fg"}`}>{row.name}</p>
                        {row.email && <p className="text-xs text-muted">{row.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className={`${TD_CLASS} max-w-[18rem]`}>
                    {isOwner ? (
                      <span className="text-xs">Todas</span>
                    ) : row.creatorIds.length === 0 ? (
                      <button type="button" onClick={edit} className={`text-xs ${LINK}`}>Asignar</button>
                    ) : (
                      <button
                        type="button"
                        onClick={edit}
                        data-testid="employee-creators"
                        title={row.creatorIds.map((id) => creatorName.get(id) ?? id).join(", ")}
                        className={`line-clamp-2 text-left ${LINK}`}
                      >
                        {row.creatorIds.map((id) => creatorName.get(id) ?? id).join(", ")}
                      </button>
                    )}
                  </td>
                  <td className={`${TD_CLASS} max-w-[14rem]`}>
                    {isOwner ? (
                      <span>{LEVEL_LABELS.owner}</span>
                    ) : (
                      <button type="button" onClick={edit} data-testid="employee-roles" title={rolesText(row)} className={`line-clamp-2 text-left ${LINK}`}>
                        {rolesText(row)}
                      </button>
                    )}
                  </td>
                  <td className={TD_CLASS}>
                    <span
                      data-testid="employee-status"
                      className={row.status === "active" ? "font-medium text-emerald-600" : row.status === "invited" ? "font-medium text-amber-600" : "text-muted"}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                    {row.status === "invited" && row.expired && <p className="mt-1 text-xs text-danger">Caducada</p>}
                  </td>
                  <td className={`${TD_CLASS} whitespace-nowrap text-xs`} data-testid="employee-last-seen" title={row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString("es-ES") : undefined}>
                    {row.kind === "invite" ? "—" : lastSeenLabel(row.lastSeenAt)}
                  </td>
                  <td className={TD_CLASS}>
                    {isOwner ? (
                      <span className="text-xs">—</span>
                    ) : (
                      <div className="relative flex items-center gap-2" data-menu-root>
                        <button type="button" onClick={edit} aria-label={`Editar ${row.name}`} className={LINK}>Editar</button>
                        <span aria-hidden className="text-line">|</span>
                        <button
                          type="button"
                          onClick={() => setMenu(menu === keyOf(row) ? null : keyOf(row))}
                          aria-label={`Más acciones de ${row.name}`}
                          aria-expanded={menu === keyOf(row)}
                          aria-haspopup="menu"
                          className={`inline-flex items-center gap-1 ${LINK}`}
                        >
                          Más <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        {menu === keyOf(row) && (
                          <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-line bg-surface p-1 text-fg shadow-lg">
                            {row.kind === "invite" && <MenuItem onClick={() => void resend(row)}>Reenviar invitación</MenuItem>}
                            {row.kind === "member" && row.status === "active" && (
                              <MenuItem onClick={() => void act("Empleado desactivado", () => setEmployeeActive({ data: { id: row.id, active: false } }))}>Desactivar</MenuItem>
                            )}
                            {row.kind === "member" && row.status === "disabled" && (
                              <MenuItem onClick={() => void act("Empleado activado", () => setEmployeeActive({ data: { id: row.id, active: true } }))}>Activar</MenuItem>
                            )}
                            {row.kind === "member" && <MenuItem onClick={() => void resetPassword(row)}>Restablecer contraseña</MenuItem>}
                            <MenuItem danger onClick={() => void remove(row)}>Borrar</MenuItem>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </StaffCard>

      {editing && (
        <EmployeeDialog
          target={editing}
          creators={creators}
          groupName={groupName}
          delivery={delivery}
          onClose={() => { setEditing(null); setDelivery(null); void reload(); }}
          onDelivery={(value) => { setDelivery(value); void reload(); }}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
      {!editing && delivery && <DeliveryDialog title="Invitación" ttl="7 días" delivery={delivery} onClose={() => setDelivery(null)} />}
      {resetDelivery && <DeliveryDialog title="Restablecer contraseña" ttl="24 horas" delivery={resetDelivery} onClose={() => setResetDelivery(null)} />}
      {bulkRoles && (
        <BulkRolesDialog
          count={chosen.length}
          onClose={() => setBulkRoles(false)}
          onApply={async (roles) => {
            try {
              await setEmployeeRoles({ data: { targets: chosen.map((row) => ({ id: row.id, kind: row.kind })), roles } });
              toast.success("Roles actualizados");
              setBulkRoles(false);
              setPicked([]);
              await reload();
            } catch (error) {
              toast.error(errorText(error));
            }
          }}
        />
      )}
      <TeamExtras people={people.map((person) => ({ id: person.id, roleLabel: person.roleLabel }))} />
    </div>
  );
}

function MenuItem({ children, onClick, danger, disabled, title }: { children: string; onClick: () => void; danger?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`block w-full rounded px-3 py-2 text-left text-sm hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${danger ? "text-danger" : ""}`}
    >
      {children}
    </button>
  );
}

function Shell({ title, onClose, children, wide, label }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; label?: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={label ?? title}>
      <div className={`max-h-[90dvh] w-full ${wide ? "max-w-xl" : "max-w-md"} overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl`}>
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

function DeliveryPanel({ delivery, ttl }: { delivery: InviteDelivery; ttl: string }) {
  return (
    <div className="space-y-2" data-testid="invite-delivery">
      <p className="text-sm">{mailNote(delivery)}</p>
      <p className="text-xs text-muted">El enlace es de un solo uso y caduca en {ttl}.</p>
      <div className="flex gap-2">
        <Field readOnly value={delivery.link} aria-label="Enlace" data-testid="invite-link" onFocus={(event) => event.currentTarget.select()} />
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

function DeliveryDialog({ title, ttl, delivery, onClose }: { title: string; ttl: string; delivery: InviteDelivery; onClose: () => void }) {
  return (
    <Shell title={title} onClose={onClose}>
      <DeliveryPanel delivery={delivery} ttl={ttl} />
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>Listo</Button></div>
    </Shell>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="border-t border-line pt-3 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>;
}

function Chip({ children, onRemove, label }: { children: React.ReactNode; onRemove?: () => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#1d9bf0]/10 px-2.5 py-1 text-xs text-[#1d9bf0]" data-testid="chip">
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={label} className="rounded-full p-0.5 hover:bg-[#1d9bf0]/20">
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

const BLUE_BUTTON = "bg-[#1d9bf0] hover:bg-[#1a8cd8]";

/** Pop-up de permisos agrupados, premarcados según los roles. Lo que se marca de más se guarda por empleado. */
export function PermsDialog({
  roles,
  initial,
  applyLabel,
  onApply,
  onCancel,
}: {
  roles: StaffLevel[];
  initial: string[];
  applyLabel: string;
  onApply: (perms: string[]) => void;
  onCancel: () => void;
}) {
  const preset = useMemo(() => presetPerms(roles), [roles]);
  const [checked, setChecked] = useState<string[]>(initial);
  const toggle = (perm: string) => setChecked((list) => (list.includes(perm) ? list.filter((item) => item !== perm) : [...list, perm]));
  const summary = describePerms(checked.filter((perm) => !isPermLocked(roles, perm as never)));
  return (
    <Shell title="Permisos del rol" onClose={onCancel} wide label="Permisos del rol">
      <p className="mb-3 text-sm text-muted" data-testid="perms-roles">
        Premarcados según {roles.map((role) => LEVEL_LABELS[role]).join(" + ")}. Marca lo que quieras añadir: se guarda para este empleado.
      </p>
      <div className="mb-3 rounded-lg bg-raised p-3 text-sm" data-testid="perms-summary-text">
        <p><span className="font-medium">Podrá:</span> {summary.can.length > 0 ? summary.can.join(", ") : "nada todavía"}.</p>
        {summary.cannot.length > 0 && <p className="mt-1 text-muted"><span className="font-medium">No podrá:</span> {summary.cannot.join(", ")}.</p>}
      </div>
      <div className="space-y-3" data-testid="perms-groups">
        {PERM_GROUPS.map((group) => (
          <fieldset key={group.id} aria-label={group.label} className="rounded-lg border border-line p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{group.label}</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {group.perms.map((perm) => {
                const locked = isPermLocked(roles, perm);
                return (
                  <label key={perm} className={`flex items-start gap-2 text-sm ${locked ? "opacity-50" : ""}`} title={locked ? "El chatter no recibe este permiso" : undefined}>
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-primary"
                      checked={checked.includes(perm) && !locked}
                      disabled={locked}
                      onChange={() => toggle(perm)}
                      data-perm={perm}
                    />
                    <span>
                      {PERM_LABELS[perm]}
                      {preset.includes(perm) && <span className="ml-1 text-[10px] text-muted">(del rol)</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={() => setChecked([...preset])}>Volver al rol</Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button type="button" className={BLUE_BUTTON} onClick={() => onApply(checked.filter((perm) => !isPermLocked(roles, perm as never)))}>{applyLabel}</Button>
        </div>
      </div>
    </Shell>
  );
}

function RolePicker({ roles, onChange }: { roles: StaffLevel[]; onChange: (next: StaffLevel[]) => void }) {
  const rest = INVITABLE_LEVELS.filter((role) => !roles.includes(role));
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" data-testid="role-chips">
        {roles.map((role) => (
          <Chip key={role} label={`Quitar rol ${LEVEL_LABELS[role]}`} onRemove={roles.length > 1 ? () => onChange(roles.filter((item) => item !== role)) : undefined}>
            {LEVEL_LABELS[role]}
          </Chip>
        ))}
      </div>
      {rest.length > 0 && (
        <Select
          className="mt-2 w-full"
          value=""
          aria-label="Añadir rol"
          onChange={(event) => {
            const role = INVITABLE_LEVELS.find((item) => item === event.target.value);
            if (role) onChange([...roles, role]);
          }}
        >
          <option value="">Añadir rol…</option>
          {rest.map((role) => <option key={role} value={role}>{LEVEL_LABELS[role]}</option>)}
        </Select>
      )}
    </div>
  );
}

function BulkRolesDialog({ count, onClose, onApply }: { count: number; onClose: () => void; onApply: (roles: string[]) => Promise<void> }) {
  const [roles, setRoles] = useState<StaffLevel[]>(["chatter"]);
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="Editar roles en grupo" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Se aplican a {count} {count === 1 ? "empleado" : "empleados"}. Sus permisos pasan a los del rol; después se afinan en Editar.</p>
      <RolePicker roles={roles} onChange={setRoles} />
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button
          type="button"
          className={BLUE_BUTTON}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onApply(roles).finally(() => setBusy(false));
          }}
        >
          Guardar
        </Button>
      </div>
    </Shell>
  );
}

function EmployeeDialog({
  target,
  creators,
  groupName,
  delivery,
  onClose,
  onDelivery,
  onSaved,
}: {
  target: EmployeeRow | "new";
  creators: CreatorOption[];
  groupName: string;
  delivery: InviteDelivery | null;
  onClose: () => void;
  onDelivery: (delivery: InviteDelivery) => void;
  onSaved: () => void;
}) {
  const row = target === "new" ? null : target;
  const isMember = row?.kind === "member";
  const initialRoles: StaffLevel[] = row ? row.roles.filter((role) => role !== "owner") : ["chatter"];
  const [name, setName] = useState(row?.name ?? "");
  const [email, setEmail] = useState(row?.email ?? "");
  const [roles, setRoles] = useState<StaffLevel[]>(initialRoles.length > 0 ? initialRoles : ["chatter"]);
  const [picked, setPicked] = useState<string[]>(row?.creatorIds ?? []);
  const [perms, setPerms] = useState<string[]>(row?.perms ?? presetPerms(["chatter"]));
  const [confirmed, setConfirmed] = useState(Boolean(row));
  const [popup, setPopup] = useState<{ roles: StaffLevel[]; initial: string[]; reason: "roles" | "manual" | "create" } | null>(null);
  const [phone, setPhone] = useState(row?.phone ?? "");
  const [alerts, setAlerts] = useState(row?.alertsEnabled ?? false);
  const [quiet, setQuiet] = useState(String(row?.quietMinutes ?? 15));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = creators.filter((item) => !picked.includes(item.id));

  function changeRoles(next: StaffLevel[]) {
    setPopup({ roles: next, initial: presetPerms(next), reason: "roles" });
  }

  async function save(finalPerms: string[]) {
    setBusy(true);
    setError(null);
    try {
      if (row) {
        await editEmployee({ data: { id: row.id, kind: row.kind, name, roles, creatorIds: picked, perms: finalPerms } });
        if (isMember) {
          const alertChanged = phone.trim() !== (row.phone ?? "") || alerts !== row.alertsEnabled || (Number(quiet) || 15) !== row.quietMinutes;
          if (alertChanged) await updateStaffAlert({ data: { userId: row.id, phone, enabled: alerts, quietMinutes: Number(quiet) || 15 } });
        }
        toast.success("Cambios guardados");
        onSaved();
      } else {
        const result = await inviteEmployee({ data: { name, email, roles, creatorIds: picked, perms: finalPerms } });
        onDelivery(result);
        toast.success(result.mail.sent ? `Invitación enviada a ${result.email}` : "Invitación creada");
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!row && !confirmed) {
      setPopup({ roles, initial: perms, reason: "create" });
      return;
    }
    void save(perms);
  }

  if (delivery && !row) {
    return (
      <Shell title="Invitación creada" onClose={onClose}>
        <DeliveryPanel delivery={delivery} ttl="7 días" />
        <div className="mt-4 flex justify-end"><Button onClick={onClose}>Listo</Button></div>
      </Shell>
    );
  }

  return (
    <>
      <Shell title={row ? "Editar empleado" : "Añadir empleado"} onClose={onClose} wide>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Nombre de empleado*</span>
            <Field value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} aria-label="Nombre de empleado" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Correo electrónico*</span>
            <Field
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required={!row}
              disabled={Boolean(row)}
              placeholder={row && !row.email ? "Sin correo (cuenta antigua)" : undefined}
              aria-label="Correo electrónico"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Grupo*</span>
            <Select className="w-full" value={groupName} onChange={() => undefined} aria-label="Grupo" required>
              <option value={groupName}>{groupName}</option>
            </Select>
          </label>
          <div className="text-sm">
            <span className="mb-1 block font-medium">Rol*</span>
            <RolePicker roles={roles} onChange={changeRoles} />
          </div>

          <SectionTitle>Asignar creador(es)</SectionTitle>
          <div className="text-sm">
            <div className="flex flex-wrap gap-1.5" data-testid="creator-chips">
              {picked.map((id) => {
                const creator = creators.find((item) => item.id === id);
                const label = creator ? creatorLabel(creator) : id;
                return <Chip key={id} label={`Quitar ${label}`} onRemove={() => setPicked((list) => list.filter((item) => item !== id))}>{label}</Chip>;
              })}
              {picked.length === 0 && <span className="text-xs text-muted">Sin creadoras asignadas.</span>}
            </div>
            {available.length > 0 && (
              <Select
                className="mt-2 w-full"
                value=""
                aria-label="Asignar creador(es)"
                onChange={(event) => {
                  const id = event.target.value;
                  if (id) setPicked((list) => [...list, id]);
                }}
              >
                <option value="">Añadir creadora…</option>
                {available.map((item) => <option key={item.id} value={item.id}>{creatorLabel(item)}</option>)}
              </Select>
            )}
            {perms.includes("todas") && <p className="mt-2 text-xs text-muted">Con el permiso «Todas las creadoras» ve todas, estén asignadas o no.</p>}
          </div>

          <SectionTitle>Permisos</SectionTitle>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span data-testid="perms-summary">{perms.length} {perms.length === 1 ? "permiso" : "permisos"} activos</span>
            <Button type="button" variant="soft" onClick={() => setPopup({ roles, initial: perms, reason: "manual" })}>Ver y editar permisos</Button>
          </div>

          {row && (
            <>
              <SectionTitle>Avisos por teléfono</SectionTitle>
              {isMember ? (
                <fieldset className="space-y-2 text-sm" aria-label="Avisos por teléfono">
                  <label className="block text-xs text-muted">
                    WhatsApp
                    <Field value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+34600000000" aria-label="WhatsApp" className="mt-1" />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={alerts} onChange={(event) => setAlerts(event.target.checked)} />
                    Avisos
                  </label>
                  <label className="block text-xs text-muted">
                    Minutos entre avisos del mismo fan
                    <Field value={quiet} onChange={(event) => setQuiet(event.target.value)} inputMode="numeric" aria-label="Minutos entre avisos del mismo fan" className="mt-1 w-24" />
                  </label>
                </fieldset>
              ) : (
                <p className="text-xs text-muted">Se configuran cuando acepte la invitación.</p>
              )}
            </>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy} className={BLUE_BUTTON}>Guardar</Button>
          </div>
        </form>
      </Shell>
      {popup && (
        <PermsDialog
          key={`${popup.reason}-${popup.roles.join("+")}`}
          roles={popup.roles}
          initial={popup.initial}
          applyLabel={popup.reason === "create" ? "Confirmar y añadir" : "Aplicar permisos"}
          onCancel={() => setPopup(null)}
          onApply={(next) => {
            setRoles(popup.roles);
            setPerms(next);
            setConfirmed(true);
            const create = popup.reason === "create";
            setPopup(null);
            if (create) void save(next);
          }}
        />
      )}
    </>
  );
}
