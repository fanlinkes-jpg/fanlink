import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { MoreVertical, Pencil, Plus, Settings, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Select } from "@/components/ui";
import { StaffCard, TABLE_CLASS, TD_CLASS, THEAD_CLASS, TH_CLASS, TR_CLASS } from "@/components/staff-card";
import { CreatorMark } from "@/components/creator-mark";
import { FixedMenu } from "@/components/fixed-menu";
import { ProxyForm } from "@/components/proxy-form";
import { useCrm, type Creator, type Platform } from "@/lib/crm";
import { PLATFORMS } from "@/features/growth-pages";
import { listCreatorAssignments, setCreatorAssignees, type AssignedEmployee, type CreatorAssignment } from "@/lib/creators";
import { connectivityOf, formatSyncAge, moneyUsd, todaySalesCents } from "@/lib/creator-board";
import { staffNamesFor as namesFromAssignments } from "@/lib/creator-assignments";
import { setCreatorProxy } from "@/lib/of-sessions";
import { useCreatorSessions, sessionErrorText } from "@/lib/use-creator-sessions";
import { useOfReads } from "@/lib/use-of-reads";
import { creatorAvatarOf } from "@/lib/creator-avatar";
import { hasPerm } from "@/lib/access-policy";

const LINK = "text-[#1d9bf0] hover:underline";
const BLUE_BUTTON = "bg-[#1d9bf0] hover:bg-[#1a8cd8]";
const STICKY = "sticky right-0 z-10 bg-surface shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)]";
const GENDERS = [
  { value: "", label: "Sin indicar" },
  { value: "mujer", label: "Mujer" },
  { value: "hombre", label: "Hombre" },
  { value: "otro", label: "Otro" },
  { value: "na", label: "Prefiero no decirlo" },
] as const;

function errorText(error: unknown): string {
  return sessionErrorText(error);
}

function handleOf(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function OfMark() {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#00aff0] text-[9px] font-bold text-white" aria-hidden>
      OF
    </span>
  );
}

export function CreatorsPage() {
  const agency = useCrm((state) => state.agency);
  const creators = useCrm((state) => state.creators);
  const addCreator = useCrm((state) => state.addCreator);
  const updateCreator = useCrm((state) => state.updateCreator);
  const teamAccess = useCrm((state) => state.teamAccess);
  const sessions = useCreatorSessions();
  const reads = useOfReads("dashboard");
  const navigate = useNavigate();

  const [assignments, setAssignments] = useState<CreatorAssignment[]>([]);
  const [staff, setStaff] = useState<AssignedEmployee[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [platformDraft, setPlatformDraft] = useState("todas");
  const [tagDraft, setTagDraft] = useState("todas");
  const [connectDraft, setConnectDraft] = useState("todos");
  const [employeeDraft, setEmployeeDraft] = useState("todos");
  const [accountDraft, setAccountDraft] = useState("todos");
  const [editing, setEditing] = useState<Creator | "new" | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);

  const refreshAssignments = useCallback(async () => {
    try {
      const result = await listCreatorAssignments();
      setAssignments(result.rows);
      setStaff(result.staff);
      setAllowed(result.allowed);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorText(error));
    }
  }, []);

  useEffect(() => {
    void refreshAssignments();
  }, [refreshAssignments]);

  const tags = useMemo(() => {
    const values = [...new Set(creators.map((item) => item.tag?.trim()).filter((item): item is string => Boolean(item)))];
    values.sort((left, right) => left.localeCompare(right, "es"));
    return values;
  }, [creators]);

  const platforms = useMemo(() => {
    const values = [...new Set(creators.map((item) => item.platform))];
    values.sort();
    return values;
  }, [creators]);

  const visible = useMemo(() => {
    const name = nameDraft.trim().toLowerCase();
    return creators.filter((creator) => {
      const live = sessions.byCreator.get(creator.id);
      const read = reads.byCreator.get(creator.id);
      const conn = connectivityOf(live ? { status: live.status, signedReadsBlocked: live.readsBlocked } : undefined);
      const employees = namesFromAssignments(assignments, creator.id);
      if (name) {
        const blob = `${creator.name} ${creator.nick ?? ""} ${creator.handle} ${handleOf(live?.identityHandle)}`.toLowerCase();
        if (!blob.includes(name)) return false;
      }
      if (platformDraft !== "todas" && creator.platform !== platformDraft) return false;
      if (tagDraft !== "todas" && (creator.tag ?? "") !== tagDraft) return false;
      if (connectDraft !== "todos" && conn.kind !== connectDraft) return false;
      if (employeeDraft !== "todos") {
        if (employeeDraft === "ninguno") {
          if (employees.length > 0) return false;
        } else if (!employees.some((item) => item === employeeDraft)) {
          return false;
        }
      }
      if (accountDraft !== "todos" && creator.status !== accountDraft) return false;
      void read;
      return true;
    });
  }, [accountDraft, assignments, connectDraft, creators, employeeDraft, nameDraft, platformDraft, reads.byCreator, sessions.byCreator, tagDraft]);

  function clearFilters() {
    setNameDraft("");
    setPlatformDraft("todas");
    setTagDraft("todas");
    setConnectDraft("todos");
    setEmployeeDraft("todos");
    setAccountDraft("todos");
  }

  const canAdd = teamAccess?.role === "owner";
  const canEdit = hasPerm(teamAccess, "equipo");

  if (!allowed && !canEdit) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">No tienes permiso para gestionar las creadoras.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="creators-page">
      <StaffCard
        title={agency.trim() || "Creadoras"}
        testId="creators-card"
        right={
          canAdd ? (
            <Button className={BLUE_BUTTON} onClick={() => setEditing("new")} aria-label="Añadir creadora">
              <Plus className="h-4 w-4" aria-hidden /> Añadir creadora
            </Button>
          ) : null
        }
        filters={
          <form
            onSubmit={(event) => {
              event.preventDefault();
              document.querySelector("[data-testid='creators-table']")?.scrollIntoView({ block: "nearest" });
            }}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3"
            data-testid="creator-filters"
          >
            <label className="text-xs text-muted">
              Nombre del creador
              <Field value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} placeholder="Nombre o usuario" aria-label="Nombre del creador" className="mt-1 block w-52" />
            </label>
            <label className="text-xs text-muted">
              Plataforma
              <Select value={platformDraft} onChange={(event) => setPlatformDraft(event.target.value)} aria-label="Plataforma" className="mt-1 block w-40">
                <option value="todas">Todas</option>
                {platforms.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-muted">
              Etiqueta
              <Select value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} aria-label="Etiqueta" className="mt-1 block w-40">
                <option value="todas">Todas</option>
                {tags.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-muted">
              Estado de conectividad
              <Select value={connectDraft} onChange={(event) => setConnectDraft(event.target.value)} aria-label="Estado de conectividad" className="mt-1 block w-44">
                <option value="todos">Todos</option>
                <option value="connected">Conectado</option>
                <option value="expired">Sesión caducada</option>
                <option value="pending">Pendiente de login</option>
                <option value="offline">Sin sesión</option>
              </Select>
            </label>
            <label className="text-xs text-muted">
              Empleado
              <Select value={employeeDraft} onChange={(event) => setEmployeeDraft(event.target.value)} aria-label="Empleado" className="mt-1 block w-44">
                <option value="todos">Todos</option>
                <option value="ninguno">Sin asignar</option>
                {staff.map((item) => (
                  <option key={item.id} value={item.name}>{item.name}</option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-muted">
              Estado de la cuenta
              <Select value={accountDraft} onChange={(event) => setAccountDraft(event.target.value)} aria-label="Estado de la cuenta" className="mt-1 block w-40">
                <option value="todos">Todos</option>
                <option value="activa">Activa</option>
                <option value="pausa">En pausa</option>
              </Select>
            </label>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="soft" onClick={clearFilters}>Reestablecer</Button>
              <Button type="submit" className={BLUE_BUTTON}>Buscar</Button>
            </div>
          </form>
        }
      >
        {loadError && <p role="alert" className="border-b border-line p-3 text-sm text-danger">{loadError}</p>}
        <table className={`${TABLE_CLASS} min-w-[1280px]`} data-testid="creators-table">
          <thead className={THEAD_CLASS}>
            <tr>
              <th className={TH_CLASS}>Creador</th>
              <th className={TH_CLASS}>Apodo</th>
              <th className={TH_CLASS} aria-label="Etiqueta">
                <span className="inline-flex items-center gap-1">
                  Etiqueta
                  <button type="button" className="rounded p-0.5 text-muted hover:bg-raised" aria-label="Gestionar etiquetas" onClick={() => setTagsOpen(true)}>
                    <Settings className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>
              </th>
              <th className={TH_CLASS}>Cuenta</th>
              <th className={TH_CLASS}>ID del Creador</th>
              <th className={TH_CLASS}>Empleados</th>
              <th className={TH_CLASS}>Estado de conectividad</th>
              <th className={TH_CLASS}>Última sincronización</th>
              <th className={TH_CLASS}>Ventas de hoy</th>
              <th className={`${TH_CLASS} ${STICKY}`}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-muted">No hay creadoras con estos filtros.</td>
              </tr>
            )}
            {visible.map((creator) => {
              const live = sessions.byCreator.get(creator.id);
              const read = reads.byCreator.get(creator.id);
              const conn = connectivityOf(live ? { status: live.status, signedReadsBlocked: live.readsBlocked } : undefined);
              const employees = namesFromAssignments(assignments, creator.id);
              const handle = handleOf(live?.identityHandle) || handleOf(creator.handle) || "—";
              const nick = (creator.nick ?? live?.identityName ?? "").trim() || "—";
              const avatar = creator.photoUrl || creatorAvatarOf(live) || live?.avatarUrl || null;
              const sales = todaySalesCents(read);
              const syncAt = read?.earningsSyncedAt ?? read?.fansSyncedAt ?? read?.lastAttemptAt ?? null;
              const reason = read?.lastReason ?? live?.lastError ?? null;
              const expired = conn.kind === "expired";
              return (
                <tr key={creator.id} className={TR_CLASS} data-testid="creator-row" data-creator={creator.name}>
                  <td className={TD_CLASS}>
                    <div className="flex items-center gap-3">
                      <CreatorMark name={creator.name} hue={creator.hue} avatarUrl={avatar} size="md" />
                      <p className="font-medium text-fg">{creator.name}</p>
                    </div>
                  </td>
                  <td className={`${TD_CLASS} max-w-[12rem]`}>
                    <p className="truncate" title={nick}>{nick}</p>
                  </td>
                  <td className={TD_CLASS}>
                    <span className="inline-flex items-center gap-1">
                      {creator.tag?.trim() || "—"}
                      <button type="button" className="rounded p-0.5 text-muted hover:bg-raised" aria-label={`Gestionar etiquetas de ${creator.name}`} onClick={() => setTagsOpen(true)}>
                        <Settings className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </span>
                  </td>
                  <td className={TD_CLASS}>
                    <span className="inline-flex items-center gap-2">
                      <OfMark />
                      <span>OnlyFans</span>
                    </span>
                  </td>
                  <td className={TD_CLASS}>
                    <span className={LINK}>{handle}</span>
                  </td>
                  <td className={`${TD_CLASS} max-w-[14rem]`}>
                    {employees.length === 0 ? (
                      <button type="button" className={`text-xs ${LINK}`} onClick={() => setEditing(creator)}>
                        Sin asignar
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="creator-employees"
                        title={employees.join(", ")}
                        onClick={() => setEditing(creator)}
                        className={`line-clamp-2 text-left ${LINK}`}
                      >
                        {employees.join(", ")}
                      </button>
                    )}
                  </td>
                  <td className={TD_CLASS}>
                    {expired ? (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-danger">Sesión caducada</p>
                        <Button
                          className={BLUE_BUTTON}
                          onClick={() => void navigate({ to: "/conectar", search: { creadora: creator.id } })}
                        >
                          Reconectar
                        </Button>
                      </div>
                    ) : (
                      <span
                        className={conn.kind === "connected" ? "font-medium text-emerald-600" : "text-muted"}
                        title={reason ?? undefined}
                      >
                        {conn.label}
                      </span>
                    )}
                  </td>
                  <td className={TD_CLASS}>
                    <span title={reason ?? syncAt ?? undefined}>{formatSyncAge(syncAt)}</span>
                  </td>
                  <td className={`${TD_CLASS} tabular-nums`}>{sales == null ? "Sin datos" : moneyUsd(sales)}</td>
                  <td className={`${TD_CLASS} ${STICKY}`}>
                    <div className="relative flex items-center gap-1">
                      <button type="button" className="rounded p-1 text-muted hover:bg-raised" aria-label={`Editar ${creator.name}`} onClick={() => setEditing(creator)}>
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 text-muted hover:bg-raised"
                        aria-label={`Más acciones de ${creator.name}`}
                        aria-haspopup="menu"
                        aria-expanded={menuId === creator.id}
                        onClick={(event) => {
                          if (menuId === creator.id) {
                            setMenuId(null);
                            return;
                          }
                          menuAnchor.current = event.currentTarget;
                          setMenuId(creator.id);
                        }}
                      >
                        <MoreVertical className="h-4 w-4" aria-hidden />
                      </button>
                      <FixedMenu
                        open={menuId === creator.id}
                        anchor={menuId === creator.id ? menuAnchor.current : null}
                        onClose={() => setMenuId(null)}
                        label={`Más acciones de ${creator.name}`}
                        className="w-64"
                      >
                        <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left hover:bg-raised" onClick={() => { setMenuId(null); setEditing(creator); }}>
                          Editar detalles
                        </button>
                        <Link
                          role="menuitem"
                          to="/conectar"
                          search={{ creadora: creator.id }}
                          className="block rounded px-3 py-2 hover:bg-raised"
                          onClick={() => setMenuId(null)}
                        >
                          {expired ? "Reconectar" : "Abrir Conectar"}
                        </Link>
                        {reason ? (
                          <p className="px-3 py-2 text-xs text-muted" title={reason}>
                            Último aviso: {reason}
                          </p>
                        ) : null}
                      </FixedMenu>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          Los empleados salen de las asignaciones reales. Las ventas de hoy y la última sincronización solo se muestran si hay un sync; si no hay dato, se indica «Sin datos».
        </p>
      </StaffCard>

      {editing === "new" && (
        <AddCreatorDialog
          onClose={() => setEditing(null)}
          onSave={(input) => {
            addCreator(input);
            setEditing(null);
            toast.success("Creadora añadida");
          }}
        />
      )}
      {editing && editing !== "new" && (
        <EditCreatorForm
          creator={editing}
          staff={staff}
          assignedIds={assignments.find((item) => item.creatorId === editing.id)?.employees.map((item) => item.id) ?? []}
          tags={tags}
          session={sessions.byCreator.get(editing.id)}
          onClose={() => setEditing(null)}
          onSaved={async (patch, userIds) => {
            updateCreator(editing.id, patch);
            try {
              const result = await setCreatorAssignees({ data: { creatorId: editing.id, userIds } });
              setAssignments(result.rows);
              toast.success("Cambios guardados");
              setEditing(null);
            } catch (error) {
              toast.error(errorText(error));
            }
            void sessions.refresh?.();
          }}
        />
      )}
      {tagsOpen && (
        <TagsDialog
          tags={tags}
          creators={creators}
          onClose={() => setTagsOpen(false)}
          onRename={(from, to) => {
            const next = to.trim();
            if (!next) return;
            for (const creator of creators) {
              if (creator.tag === from) updateCreator(creator.id, { tag: next });
            }
          }}
          onRemove={(tag) => {
            for (const creator of creators) {
              if (creator.tag === tag) updateCreator(creator.id, { tag: "" });
            }
          }}
        />
      )}
    </div>
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

function SectionTitle({ children }: { children: string }) {
  return <h3 className="border-t border-line pt-3 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>;
}

function Chip({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#1d9bf0]/10 px-2.5 py-1 text-xs text-[#1d9bf0]" data-testid="chip">
      {children}
      <button type="button" onClick={onRemove} aria-label={label} className="rounded-full p-0.5 hover:bg-[#1d9bf0]/20">
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

function AddCreatorDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (input: { name: string; nick: string; handle: string; platform: Platform; city: string; tag: string }) => void;
}) {
  const [name, setName] = useState("");
  const [nick, setNick] = useState("");
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<Platform>("OnlyFans");
  const [tag, setTag] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Escribe el nombre de la creadora.");
      return;
    }
    onSave({ name, nick, handle, platform, city: "España", tag });
  }
  return (
    <Shell title="Añadir creadora" onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nombre del creador</span>
          <Field value={name} onChange={(event) => setName(event.target.value)} required aria-label="Nombre del creador" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Apodo</span>
          <Field value={nick} onChange={(event) => setNick(event.target.value)} aria-label="Apodo" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">ID del Creador</span>
          <Field value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="@usuario" aria-label="ID del Creador" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Plataforma</span>
          <Select value={platform} onChange={(event) => setPlatform(event.target.value as Platform)} aria-label="Plataforma" className="w-full">
            {PLATFORMS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </Select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Etiqueta</span>
          <Field value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Etiqueta" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="soft" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className={BLUE_BUTTON}>Guardar</Button>
        </div>
      </form>
    </Shell>
  );
}

function EditCreatorForm({
  creator,
  staff,
  assignedIds,
  tags,
  session,
  onClose,
  onSaved,
}: {
  creator: Creator;
  staff: AssignedEmployee[];
  assignedIds: string[];
  tags: string[];
  session: ReturnType<typeof useCreatorSessions>["sessions"][number] | undefined;
  onClose: () => void;
  onSaved: (patch: Partial<Pick<Creator, "name" | "nick" | "handle" | "platform" | "city" | "tag" | "status" | "gender" | "notes" | "photoUrl">>, userIds: string[]) => Promise<void>;
}) {
  const [name, setName] = useState(creator.name);
  const [nick, setNick] = useState(creator.nick ?? "");
  const [handle, setHandle] = useState(creator.handle);
  const [gender, setGender] = useState(creator.gender ?? "");
  const [tag, setTag] = useState(creator.tag ?? "");
  const [notes, setNotes] = useState(creator.notes ?? "");
  const [photoUrl, setPhotoUrl] = useState(creator.photoUrl ?? "");
  const [photoOpen, setPhotoOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(assignedIds);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sessions = useCreatorSessions();
  const live = sessions.byCreator.get(creator.id) ?? session;
  const avatar = photoUrl || creatorAvatarOf(live) || live?.avatarUrl || null;
  const linkedHandle = handleOf(live?.identityHandle) || handleOf(handle);
  const proxyOn = Boolean(live?.proxyLabel);
  const available = staff.filter((item) => !picked.includes(item.id));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Escribe el nombre de la creadora.");
      return;
    }
    setBusy(true);
    try {
      await onSaved({ name, nick, handle, tag, gender, notes, photoUrl }, picked);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Editar detalles de la cuenta" onClose={onClose} wide label="Editar detalles de la cuenta">
      <form className="space-y-3" onSubmit={submit} data-testid="edit-creator-form">
        <SectionTitle>Detalles del Creador</SectionTitle>
        <div className="flex items-center gap-4">
          <CreatorMark name={name || creator.name} hue={creator.hue} avatarUrl={avatar} size="lg" />
          <Button type="button" variant="soft" onClick={() => setPhotoOpen((open) => !open)}>Editar</Button>
        </div>
        {photoOpen && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">URL de la foto</span>
            <Field value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} placeholder="https://…" aria-label="URL de la foto" />
          </label>
        )}
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nombre del creador</span>
          <Field value={name} onChange={(event) => setName(event.target.value)} required aria-label="Nombre del creador" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Género</span>
          <Select value={gender} onChange={(event) => setGender(event.target.value)} aria-label="Género" className="w-full">
            {GENDERS.map((item) => (
              <option key={item.value || "none"} value={item.value}>{item.label}</option>
            ))}
          </Select>
        </label>

        <SectionTitle>Detalles de la cuenta</SectionTitle>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Plataforma</span>
          <Select value={creator.platform} disabled aria-label="Plataforma" className="w-full">
            <option value={creator.platform}>{creator.platform}</option>
          </Select>
        </label>
        <div className="rounded-lg border border-line p-3">
          <p className="mb-2 text-xs font-medium text-muted">Cuenta vinculada</p>
          {live ? (
            <div className="flex flex-wrap items-center gap-3">
              <CreatorMark name={live.identityName || name} hue={creator.hue} avatarUrl={live.avatarUrl} size="md" />
              <span className={LINK}>{linkedHandle || "Cuenta conectada"}</span>
              <Link to="/conectar" search={{ creadora: creator.id }} className={`ml-auto text-sm ${LINK}`}>
                Desvincular
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted">Sin cuenta vinculada.</span>
              <Link to="/conectar" search={{ creadora: creator.id }} className={`ml-auto text-sm ${LINK}`}>
                Vincular
              </Link>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">Todavía no hay una acción de servidor para quitar la sesión: se abre Conectar.</p>
        </div>

        <div className="rounded-lg border border-line p-3">
          <p className="mb-2 text-xs font-medium text-muted">Conexión proxy</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className={proxyOn ? "font-medium text-emerald-600" : "text-muted"}>{proxyOn ? "Conectado" : "Sin proxy"}</span>
            <Button type="button" variant="soft" onClick={() => setProxyOpen((open) => !open)}>Cambiar</Button>
            {proxyOn && (
              <Button
                type="button"
                variant="soft"
                onClick={() => {
                  void setCreatorProxy({ data: { creatorId: creator.id, proxy: null } })
                    .then(() => void sessions.refresh?.())
                    .catch((error) => toast.error(errorText(error)));
                }}
              >
                Borrar
              </Button>
            )}
          </div>
          {proxyOpen && (
            <ProxyForm creatorId={creator.id} label={live?.proxyLabel ?? null} onSaved={() => void sessions.refresh?.()} />
          )}
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Apodo</span>
          <Field value={nick} onChange={(event) => setNick(event.target.value)} aria-label="Apodo" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Etiqueta <span className="font-normal text-muted">(opcional)</span></span>
          <Select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Etiqueta" className="w-full">
            <option value="">Sin etiqueta</option>
            {tags.filter((item) => item !== tag).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
            {tag && !tags.includes(tag) ? <option value={tag}>{tag}</option> : null}
            {tag && tags.includes(tag) ? <option value={tag}>{tag}</option> : null}
          </Select>
          <Field className="mt-2" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="O escribe una nueva" aria-label="Nueva etiqueta" />
        </label>

        <SectionTitle>Empleados asignados</SectionTitle>
        <div className="text-sm">
          <div className="flex flex-wrap gap-1.5" data-testid="assignee-chips">
            {picked.map((id) => {
              const person = staff.find((item) => item.id === id);
              const label = person?.name ?? id;
              return (
                <Chip key={id} label={`Quitar a ${label}`} onRemove={() => setPicked((list) => list.filter((item) => item !== id))}>
                  {label}
                </Chip>
              );
            })}
            {picked.length === 0 && <span className="text-xs text-muted">Sin empleados asignados.</span>}
          </div>
          {available.length > 0 && (
            <Select
              className="mt-2 w-full"
              value=""
              aria-label="Empleados asignados"
              onChange={(event) => {
                const id = event.target.value;
                if (id) setPicked((list) => [...list, id]);
              }}
            >
              <option value="">Añadir empleado…</option>
              {available.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </Select>
          )}
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Notas internas</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            aria-label="Notas internas"
            rows={3}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
          />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="soft" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className={BLUE_BUTTON} disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
        </div>
      </form>
    </Shell>
  );
}

function TagsDialog({
  tags,
  creators,
  onClose,
  onRename,
  onRemove,
}: {
  tags: string[];
  creators: Creator[];
  onClose: () => void;
  onRename: (from: string, to: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [renames, setRenames] = useState<Record<string, string>>({});
  return (
    <Shell title="Gestionar etiquetas" onClose={onClose}>
      <div className="space-y-3">
        {tags.length === 0 && <p className="text-sm text-muted">Todavía no hay etiquetas.</p>}
        {tags.map((tag) => (
          <div key={tag} className="flex items-center gap-2">
            <Field
              value={renames[tag] ?? tag}
              onChange={(event) => setRenames((current) => ({ ...current, [tag]: event.target.value }))}
              aria-label={`Renombrar ${tag}`}
            />
            <Button
              type="button"
              variant="soft"
              onClick={() => {
                const next = (renames[tag] ?? tag).trim();
                if (next && next !== tag) onRename(tag, next);
              }}
            >
              Guardar
            </Button>
            <Button type="button" variant="soft" onClick={() => onRemove(tag)}>Borrar</Button>
            <span className="text-xs text-muted">{creators.filter((item) => item.tag === tag).length}</span>
          </div>
        ))}
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nueva etiqueta</span>
          <div className="flex gap-2">
            <Field value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Nueva etiqueta" />
            <Button
              type="button"
              className={BLUE_BUTTON}
              onClick={() => {
                const next = draft.trim();
                if (!next) return;
                setDraft("");
                toast.success(`Etiqueta «${next}» lista. Asígnala en la ficha de la creadora.`);
              }}
            >
              Añadir
            </Button>
          </div>
        </label>
        <div className="flex justify-end">
          <Button type="button" onClick={onClose}>Listo</Button>
        </div>
      </div>
    </Shell>
  );
}
