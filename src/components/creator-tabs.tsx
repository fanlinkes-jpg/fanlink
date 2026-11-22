import { CreatorMark } from "@/components/creator-mark";
import type { CreatorChipBadge } from "@/lib/inbox-scope";

/** Columna de creadoras, al estilo de Operativa. El nombre se corta; los badges no. */
export function CreatorColumn({
  creators,
  creatorId,
  avatars,
  badges,
  onSelect,
}: {
  creators: Array<{ id: string; name: string; hue: number }>;
  creatorId: string;
  avatars: Record<string, string | null>;
  badges: Record<string, CreatorChipBadge>;
  onSelect: (id: string) => void;
}) {
  const rows = creators.filter((creator) => creator.id && creator.id !== "all");
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-[#e6e8ee] bg-[#f7f8fa]" aria-label="Creadoras">
      <p className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-[#6d7585]">Creadoras</p>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((creator) => {
          const badge = badges[creator.id];
          const messages = badge?.messages ?? 0;
          const notices = badge?.notices ?? 0;
          const active = creatorId === creator.id;
          return (
            <li key={creator.id}>
              <button
                type="button"
                data-creator-row={creator.id}
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(creator.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${active ? "bg-[#e7f3ff] text-[#1d2433]" : "text-[#1d2433] hover:bg-white"}`}
              >
                <CreatorMark name={creator.name} hue={creator.hue} avatarUrl={avatars[creator.id]} size="md" />
                <span className="min-w-0 flex-1 truncate">{creator.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {messages > 0 ? (
                    <span data-badge="messages" className="min-w-7 shrink-0 rounded-full bg-danger px-1.5 text-center text-[10px] font-semibold tabular-nums leading-4 text-white" aria-label={`${messages} chats sin leer`}>{messages}</span>
                  ) : null}
                  {notices > 0 ? (
                    <span data-badge="notices" className="min-w-7 shrink-0 rounded-full bg-[#1f9d55] px-1.5 text-center text-[10px] font-semibold tabular-nums leading-4 text-white" aria-label={`${notices} notificaciones`}>{notices}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
