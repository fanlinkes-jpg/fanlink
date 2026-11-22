import { CreatorMark } from "@/components/creator-mark";
import type { CreatorChipBadge } from "@/lib/inbox-scope";

/** Pestaña de creadora. El nombre solo se corta si es muy largo, y los badges no se encogen. */
export function CreatorTabs({
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
  return (
    <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto" role="tablist" aria-label="Creadoras">
      {creators.filter((creator) => creator.id && creator.id !== "all").map((creator) => {
        const badge = badges[creator.id];
        const messages = badge?.messages ?? 0;
        const notices = badge?.notices ?? 0;
        const active = creatorId === creator.id;
        return (
          <button
            key={creator.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-creator-tab={creator.id}
            onClick={() => onSelect(creator.id)}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm ${active ? "bg-white text-[#1d2433]" : "bg-white/10 text-white"}`}
          >
            <CreatorMark name={creator.name} hue={creator.hue} avatarUrl={avatars[creator.id]} size="lg" />
            <span className="max-w-64 truncate whitespace-nowrap text-left font-medium">{creator.name}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {messages > 0 ? (
                <span data-badge="messages" className="min-w-11 shrink-0 rounded-full bg-danger px-1.5 text-center text-xs font-semibold tabular-nums leading-5 text-white" aria-label={`${messages} chats sin leer`}>{messages}</span>
              ) : null}
              {notices > 0 ? (
                <span data-badge="notices" className="min-w-11 shrink-0 rounded-full bg-[#1f9d55] px-1.5 text-center text-xs font-semibold tabular-nums leading-5 text-white" aria-label={`${notices} notificaciones`}>{notices}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
