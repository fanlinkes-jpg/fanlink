import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Field, Select } from "@/components/ui";
import { StaffCard, TABLE_CLASS, TD_CLASS, THEAD_CLASS, TH_CLASS, TR_CLASS } from "@/components/staff-card";
import {
  listShiftBoard,
  markShiftNoticesRead,
  saveEmployeeShift,
  type ShiftBoardView,
  type ShiftPersonView,
} from "@/lib/employees";
import { DAY_LABELS, DAY_NAMES, formatMinutes, isOvernight, parseTime, type ShiftSlot } from "@/lib/staff-shifts";

const BLUE_BUTTON = "bg-[#1d9bf0] hover:bg-[#1a8cd8]";

const CELL_STYLE = {
  libre: "bg-[#f3f4f6] text-[#8b93a3]",
  dia: "bg-[#e7f0ff] text-[#2456c7]",
  noche: "bg-[#efe8ff] text-[#5b3cc4]",
} as const;

const STATUS_STYLE: Record<"on" | "late" | "absent", string> = {
  on: "text-emerald-700",
  late: "text-amber-700",
  absent: "text-red-700",
};

const STATUS_DOT: Record<"on" | "late" | "absent", string> = {
  on: "bg-emerald-500",
  late: "bg-amber-500",
  absent: "bg-red-500",
};

function cellTone(day: ShiftPersonView["days"][number]): keyof typeof CELL_STYLE {
  if (day.off) return "libre";
  const slot: ShiftSlot = { weekday: day.weekday, off: day.off, startMinutes: day.startMinutes, endMinutes: day.endMinutes };
  return isOvernight(slot) ? "noche" : "dia";
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "No se ha podido guardar el horario.";
}

export function ShiftBoard({ compact = false }: { compact?: boolean } = {}) {
  const [board, setBoard] = useState<ShiftBoardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ person: ShiftPersonView; weekday: number } | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await listShiftBoard();
      setBoard(next);
      setError(null);
    } catch (failure) {
      setError(errorText(failure));
    }
  }, []);

  useEffect(() => {
    void reload();
    const tick = window.setInterval(() => void reload(), 60_000);
    return () => window.clearInterval(tick);
  }, [reload]);

  if (error && !board) {
    return <p className="text-sm text-danger" role="alert">{error}</p>;
  }
  if (!board) return null;

  const unread = board.notices.filter((item) => !item.readAt);
  const people = compact ? board.people.slice(0, 1) : board.people;
  const title = compact ? "Mi horario" : "Turnos";

  return (
    <div className="space-y-3">
      {unread.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="shift-late-notices">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium">Retrasos de turno</p>
            <Button
              type="button"
              variant="ghost"
              className="h-auto px-2 py-0.5 text-xs"
              onClick={() => void markShiftNoticesRead().then(reload)}
            >
              Marcar como vistos
            </Button>
          </div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {unread.map((item) => <li key={item.id}>{item.body}</li>)}
          </ul>
        </div>
      )}
      <StaffCard
        title={title}
        testId="turnos-card"
        right={unread.length > 0 ? <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white" data-testid="shift-late-badge">{unread.length}</span> : null}
      >
        <table className={TABLE_CLASS}>
          <thead className={THEAD_CLASS}>
            <tr>
              <th className={TH_CLASS}>Persona</th>
              {DAY_LABELS.map((label, index) => (
                <th key={label} className={`px-2 py-2 font-medium ${index === board.today ? "text-[#2456c7]" : ""}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id} className={TR_CLASS} data-testid={`shift-row-${person.id}`}>
                <td className={TD_CLASS}>
                  <p className="font-medium">{person.name}</p>
                  <p className="text-xs text-muted">{person.roleLabel}</p>
                </td>
                {person.days.map((day) => {
                  const tone = cellTone(day);
                  const name = `${person.name}, ${DAY_NAMES[day.weekday]}: ${day.label}`;
                  const ring = day.weekday === board.today ? "ring-2 ring-[#2456c7]" : "";
                  const content = (
                    <>
                      <span className="block">{day.label}</span>
                      {day.statusLabel && (
                        <span className={`mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium ${STATUS_STYLE[day.status as "on" | "late" | "absent"]}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[day.status as "on" | "late" | "absent"]}`} aria-hidden />
                          {day.statusLabel}
                        </span>
                      )}
                    </>
                  );
                  return (
                    <td key={`${person.id}-${day.weekday}`} className="px-2 py-2">
                      {board.canEdit ? (
                        <button
                          type="button"
                          data-testid={`shift-cell-${person.id}-${day.weekday}`}
                          aria-label={name}
                          onClick={() => setEditing({ person, weekday: day.weekday })}
                          className={`w-full rounded-lg px-1 py-2 text-xs ${CELL_STYLE[tone]} ${ring}`}
                        >
                          {content}
                        </button>
                      ) : (
                        <div
                          data-testid={`shift-cell-${person.id}-${day.weekday}`}
                          aria-label={name}
                          className={`w-full rounded-lg px-1 py-2 text-center text-xs ${CELL_STYLE[tone]} ${ring}`}
                        >
                          {content}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {people.length === 0 && (
              <tr className={TR_CLASS}>
                <td className={`${TD_CLASS} text-muted`} colSpan={8}>Todavía no hay horarios.</td>
              </tr>
            )}
          </tbody>
        </table>
      </StaffCard>
      {editing && (
        <ShiftEditor
          person={editing.person}
          weekday={editing.weekday}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function ShiftEditor({
  person,
  weekday,
  onClose,
  onSaved,
}: {
  person: ShiftPersonView;
  weekday: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const day = person.days[weekday] ?? person.days[0]!;
  const [off, setOff] = useState(day.off);
  const [start, setStart] = useState(day.startMinutes != null ? formatMinutes(day.startMinutes) : "08:00");
  const [end, setEnd] = useState(day.endMinutes != null ? formatMinutes(day.endMinutes) : "16:00");
  const [copy, setCopy] = useState<"none" | "weekdays" | "week">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startMin = parseTime(start);
  const endMin = parseTime(end);
  const overnight = !off && startMin != null && endMin != null && endMin <= startMin;

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

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveEmployeeShift({ data: { userId: person.id, weekday, off, start: off ? null : start, end: off ? null : end, copy } });
      toast.success("Horario guardado");
      await onSaved();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Editar horario">
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl" data-testid="shift-editor">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Horario · {person.name}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-muted hover:bg-raised">Cerrar</button>
        </div>
        <p className="mb-3 text-sm text-muted capitalize">{DAY_NAMES[weekday]} · zona Europe/Madrid</p>
        <fieldset className="mb-3 space-y-2 text-sm">
          <legend className="sr-only">Tipo de turno</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="shift-kind" checked={!off} onChange={() => setOff(false)} />
            Con horario
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="shift-kind" checked={off} onChange={() => setOff(true)} />
            Libre
          </label>
        </fieldset>
        {!off && (
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Entrada</span>
              <Field type="time" step={60} value={start} onChange={(event) => setStart(event.target.value)} aria-label="Hora de entrada" required />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Salida</span>
              <Field type="time" step={60} value={end} onChange={(event) => setEnd(event.target.value)} aria-label="Hora de salida" required />
            </label>
          </div>
        )}
        {overnight && <p className="mb-3 text-xs text-muted">Este turno pasa de medianoche: termina al día siguiente.</p>}
        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-medium">Copiar horario</span>
          <Select value={copy} onChange={(event) => setCopy(event.target.value as "none" | "weekdays" | "week")} aria-label="Copiar horario" className="w-full">
            <option value="none">Solo este día</option>
            <option value="weekdays">A días laborables (Lun–Vie)</option>
            <option value="week">A toda la semana</option>
          </Select>
        </label>
        {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="button" className={BLUE_BUTTON} disabled={busy} onClick={() => void save()}>Guardar</Button>
        </div>
      </div>
    </div>
  );
}
