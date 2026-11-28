import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AtSign, Bell, Check, CheckCheck, ChevronLeft, ChevronRight, Clock, DollarSign, FolderOpen, ImagePlus, Languages, Lock, RefreshCw, ScrollText, Send, Type, BellOff, EllipsisVertical, Images, Pin, Search, Star, StickyNote, Pencil } from "lucide-react";
import { broadcastOnlineFans, cancelOnlineBroadcast, chatSendAccess, discardChatOutbound, listCreatorChats, listOnlineFans, loadMoreChats, loadOlderMessages, markChatOpened, readChatVault, readFanPurchases, readThreadHistory, readVisibleFanSpend, recordChatOutbound, resolveOnlineOutbound, reviewChatOutbound, runFanChatMenu, saveFanFlag, saveFanNote, saveFanProfile, syncCreatorChats, type CreatorChatList } from "@/lib/of-sessions";
import { OnlineFansPanel, type OnlineBroadcastPayload } from "@/features/online-fans-panel";
import type { OnlineFanRow } from "@/lib/online-fan-row";
import { applyFlagOverrides, flagKey, patchedFlag } from "../../server/of-sessions/sync/fan-flags.ts";
import { ChatGalleryPanel } from "@/features/chat-gallery-panel";
import { ChatFindBar } from "@/features/chat-find-bar";
import { findMessages, highlightParts, stepMatch } from "@/lib/chat-find";
import { unreadChatRow } from "../../server/of-sessions/sync/unread-chats.ts";
import { inboxPillCounts, matchesInboxPill, tipThreads, type InboxPill } from "../../server/of-sessions/sync/chat-pills.ts";
import { accountFigure, everyAccountBlocked, SESSION_EXPIRED_LABEL } from "../../server/of-sessions/sync/session-link.ts";
import { ensureNoticeTab, listCreatorNotifications, markCreatorNotificationsRead, type NotificationListItem } from "@/lib/of-notifications";
import { NOTIFICATION_TABS, TAB_LABEL, isOwnerOnlyKind, notesForCreator, notesResponseApplies, noticeFace, notificationReplyLine, noticesForOfTab, notificationOpensChat, ofTabListNote, tabOf, type NotificationCounts, type NotificationTab } from "@/lib/notifications";
import { NotificationFanCard } from "@/features/notification-card";
import { PurchaseMessageDialog } from "@/features/purchase-message-dialog";
import { purchaseComposeDraft } from "@/lib/purchase-detail";
import { useCrm, type VaultItem } from "@/lib/crm";
import { chatSyncLabel, headerSyncLabel, type ChatSyncInput } from "@/lib/chat-sync-label";
import { sessionErrorText } from "@/lib/use-creator-sessions";
import { inboxCreators, inboxThreadList, readInboxCreator, resolveInboxCreator, rowsForCreator, writeInboxCreator } from "@/lib/inbox-scope";
import { useCreatorNoticeBadges } from "@/lib/use-creator-notice-badges";
import { COMPOSER_LANGUAGES, setComposerLanguage, useComposerLanguage } from "@/lib/ui-prefs";
import { SfwMedia } from "@/components/sfw-media";
import { fanListedOnline, fanShowsOnline, lastSeenLabel, showOnlineDot } from "@/lib/online-dot";
import { acceptedVaultPieces, chatVaultCreator, chatVaultOnThreadChange, mergeVaultPage, vaultFolderOnAccountChange, vaultLoadAllowed, vaultReadApplies } from "@/lib/vault-load";
import { VAULT_FOLDER_READ_ERROR } from "@/lib/vault-folder-label";
import { clearOpenThread, peekOpenThread } from "@/lib/open-thread";
import { useChatFanCards } from "@/lib/use-chat-fan-cards";
import { chatFanCardFor, fanCardTransactions } from "@/lib/chat-fan-cards";
import { FanInsights } from "@/features/fan-insights";
import { mergePpvSources } from "@/lib/ppv-timeline";
import { MessagePriceDialog } from "@/features/message-price-dialog";
import { FULL_EMOJIS, QUICK_EMOJIS, TEXT_COLORS, authorLabel, matchScripts, mentionToken, ppvPreviewMissing, slashQuery, vaultOfferFlagsAfterPrice, wrapSelection } from "@/lib/composer-tools";
import { REAL_SEND_OFF_REASON } from "@/lib/chat-send-session";
import { confirmedMatches, pendingForThread, unmatchedPending } from "@/lib/pending-thread";
import { chatSendSession } from "@/lib/chat-send-session";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  bubbleCaption,
  draftFromPending,
  draftFromRejected,
  holdsForUser,
  pendingBesideLocal,
  reconcileBubbles,
  type OutboundSend,
} from "@/lib/send-queue";
import { spendTone } from "@/lib/spend-tiers";
import { rowSpendCents } from "@/lib/row-spend";
import { FanSpendLabel } from "@/lib/fan-spend-label";
import { useInboxSelection } from "@/lib/inbox-selection";
import { useStickToBottom } from "@/features/use-stick-to-bottom";
import { MessageMedia, type MessageSlide } from "@/features/message-media";
import { bubbleBlocks, bubbleText, mediaTags, pricePill, readState, tagLine } from "@/lib/chat-bubble";
import { withDateSeparators } from "@/lib/chat-dates";
import { mergeHistoryMessages, rememberThreadMessages } from "@/lib/chat-history";
import { VAULT_THUMB_MISSING, vaultMediaSrc } from "@/lib/chat-media";
import { VaultBrowser } from "@/features/vault-browser";

function profileHref(handle: string | null): string | null {
  const name = handle?.replace(/^@/, "").trim();
  return name ? `https://onlyfans.com/${name}` : null;
}

function chatHref(fanKey: string | null): string | null {
  const id = fanKey?.trim();
  return id ? `https://onlyfans.com/my/chats/chat/${id}` : null;
}

function madridClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 16);
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Madrid" }).format(date);
}

type NoteRow = NotificationListItem & { creatorId: string };

function panelNotes(rows: NoteRow[] | null, creatorId: string | null, tab: NotificationTab): NoteRow[] {
  return noticesForOfTab(notesForCreator(rows ?? [], creatorId).filter((item) => !isOwnerOnlyKind(item.kind)), tab);
}

function noteBadge(counts: NotificationCounts | null, tab: NotificationTab): string {
  const value = counts?.[tab];
  return value == null || value <= 0 ? "" : ` ${value}`;
}

function NoteTabRow({
  filter,
  counts,
  onSelect,
}: {
  filter: NotificationTab;
  counts: NotificationCounts | null;
  onSelect: (id: NotificationTab) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const node = scroller.current;
    if (!node) return;
    setEdges({
      left: node.scrollLeft > 4,
      right: node.scrollLeft + node.clientWidth < node.scrollWidth - 4,
    });
  };
  useLayoutEffect(() => {
    measure();
  }, [counts]);
  const nudge = (direction: -1 | 1) => {
    scroller.current?.scrollBy({ left: direction * 180, behavior: "smooth" });
  };
  return (
    <div className="relative">
      {edges.left ? (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-white to-transparent" />
          <button type="button" aria-label="Pestañas anteriores" className="absolute top-0 left-0 z-20 grid h-8 w-8 place-items-center text-[#3c4456]" onClick={() => nudge(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </button>
        </>
      ) : null}
      <div ref={scroller} onScroll={measure} className="flex gap-2 overflow-x-auto px-10 pb-3 [scrollbar-width:none]">
        {NOTIFICATION_TABS.map((id) => {
          const on = filter === id;
          return (
            <button key={id} type="button" onClick={() => onSelect(id)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm whitespace-nowrap ${on ? "bg-[#e7f3ff] text-[#1890d4]" : "bg-[#f2f3f5] text-[#3c4456]"}`}>
              {TAB_LABEL[id]}{noteBadge(counts, id)}
            </button>
          );
        })}
      </div>
      {edges.right ? (
        <>
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-white to-transparent" />
          <button type="button" aria-label="Pestañas siguientes" className="absolute top-0 right-0 z-20 grid h-8 w-8 place-items-center text-[#3c4456]" onClick={() => nudge(1)}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      ) : null}
    </div>
  );
}

function FanLink({ item, href, copied, onCopy }: { item: string; href: string | null; copied: boolean; onCopy: (href: string) => void }) {
  return (
    <button
      type="button"
      disabled={!href}
      className="block w-full px-4 py-3 text-left hover:bg-[#f4f7ff] disabled:text-[#b0b6c0]"
      onClick={() => {
        if (href) onCopy(href);
      }}
    >
      {copied ? "Copiado" : item}
    </button>
  );
}

const CHAT_MARKS_KEY = "fanlink.chat.marks";

function readChatMarks(): { hidden: string[]; muted: string[] } {
  if (typeof localStorage === "undefined") return { hidden: [], muted: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_MARKS_KEY) ?? "") as { hidden?: unknown; muted?: unknown };
    const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    return { hidden: list(parsed.hidden), muted: list(parsed.muted) };
  } catch {
    return { hidden: [], muted: [] };
  }
}

function keepThread<T extends { messageKey: string; sentAt: string }>(
  current: Record<string, { done: boolean; messages: T[] }>,
  key: string,
  incoming: readonly T[],
  done: boolean | null,
): Record<string, { done: boolean; messages: T[] }> {
  const prev = current[key];
  const remembered = rememberThreadMessages(prev?.messages ?? [], incoming);
  const nextDone = done == null ? prev?.done === true : done;
  if (prev && !remembered.changed && prev.done === nextDone) return current;
  return { ...current, [key]: { done: nextDone, messages: remembered.messages } };
}

function threadMark(creatorId: string, threadKey: string): string {
  return `${creatorId}:${threadKey}`;
}

function ThreadMessage({ message, find, watermark }: { watermark?: string | null; message: {
  creatorId: string;
  threadKey: string;
  messageKey: string;
  fromFan: boolean;
  body: string;
  authorName: string | null;
  automatic: boolean | null;
  mediaCount: number | null;
  media: Array<{ kind: "foto" | "video" | "audio" | null; locked?: boolean | null; seconds?: number | null; tags?: Array<{ name: string | null; username: string | null }> | null }> | null;
  priceCents: number | null;
  purchased: boolean | null;
  sentAt?: string;
  seen?: boolean | null;
}; find?: { query: string; active: boolean; flash: boolean } }) {
  const media = message.media ?? [];
  const hasMedia = (message.mediaCount ?? 0) > 0 || media.length > 0;
  const messageLocked = message.purchased === true
    ? false
    : message.priceCents != null && message.priceCents > 0 && message.purchased === false;
  const slideLocked = (slide: { locked?: boolean | null }) => message.purchased === true ? false : messageLocked || slide.locked === true;
  const slides: MessageSlide[] = media.length === 0
    ? (hasMedia ? [{ index: 0, kind: "video", locked: messageLocked, seconds: null }] : [])
    : media.map((slide, index) => ({ index, kind: slide.kind, locked: slideLocked(slide), seconds: slide.seconds ?? null }));
  const layout = bubbleBlocks({
    mediaCount: slides.length,
    priceCents: message.priceCents,
    body: message.body,
  });
  const who = message.fromFan ? "" : message.authorName ? authorLabel(message.authorName, false) : authorLabel(null, message.automatic);
  const pill = pricePill(message);
  const tags = tagLine(mediaTags(message.media));
  const text = bubbleText(message.body, slides.length > 0 || pill != null);
  const when = message.sentAt ? madridClock(message.sentAt) : "";
  const read = readState(message);
  const marked = (value: string) => find && find.query
    ? highlightParts(value, find.query).map((part, index) => part.hit ? <mark key={index} className="rounded bg-[#ffe58f] px-0.5">{part.text}</mark> : <span key={index}>{part.text}</span>)
    : value;
  const hasBubble = slides.length > 0 || message.body || pill != null;
  const footer = pill != null || who || when || read != null;
  return (
    <li data-message-id={message.messageKey} className={message.fromFan ? "" : "text-right"} data-layout={layout.layout} data-automatic={message.automatic ? "1" : "0"}>
      {hasBubble ? (
      <div className={`inline-flex flex-col overflow-hidden rounded-[22px] text-left text-[15px] leading-relaxed text-[#1d2433] shadow-[0_1px_3px_rgba(29,36,51,0.08),0_6px_18px_-8px_rgba(29,36,51,0.12)] ${slides.length > 0 ? "w-[70%] max-w-[380px]" : "max-w-[70%]"} ${message.fromFan ? "border border-[#eceff5] bg-white" : "bg-[#e3edff]"} ${find?.active || find?.flash ? "ring-2 ring-[#ffb020] ring-offset-2" : ""}`}>
        {slides.length > 0 ? (
          <MessageMedia
            ids={{ creatorId: message.creatorId, threadKey: message.threadKey, messageKey: message.messageKey }}
            slides={slides}
            watermark={message.fromFan ? null : watermark ?? null}
            tagged={tags != null}
            priceLabel={pill ? `${pill.money} · ${pill.label}` : null}
          />
        ) : null}
        {tags ? (
          <p className="flex items-center gap-1.5 bg-[#d3e4ff]/70 px-4 py-1.5 text-xs text-[#2456c7]" title={tags}>
            <AtSign className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="shrink-0 font-medium">Etiquetas</span>
            <span className="truncate">· {tags}</span>
          </p>
        ) : null}
        {text.title || text.paragraphs.length > 0 ? (
          <div className="space-y-2 px-4 py-3">
            {text.title ? <p className="font-semibold tracking-[-0.01em] text-[#111827]">{marked(text.title)}</p> : null}
            {text.paragraphs.map((paragraph, index) => <p key={index}>{marked(paragraph)}</p>)}
          </div>
        ) : null}
        {footer ? (
          <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pb-2.5 text-[11px] text-[#7a8496] ${text.title || text.paragraphs.length > 0 ? "" : "pt-2.5"}`}>
            {pill ? (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold ring-1 ring-inset ${pill.state === "pagado" ? "bg-[#e6f6ec] text-[#13693a] ring-[#bfe5cd]" : pill.state === "no pagado" ? "bg-[#fff3e0] text-[#9a5b00] ring-[#f6dcae]" : "bg-[#f1f3f7] text-[#6d7585] ring-[#e1e5ec]"}`}>
                {pill.money}{" "}<span className="font-medium opacity-80">· {pill.label}</span>
              </span>
            ) : <span />}
            <span className="ml-auto inline-flex items-center gap-1.5">
              {who ? <span>{who}</span> : null}
              {who && when ? <span aria-hidden>·</span> : null}
              {when ? <span>{when}</span> : null}
              {read === "leido" ? <CheckCheck className="h-3.5 w-3.5 text-[#3b6cff]" aria-label="Leído" /> : read === "enviado" ? <Check className="h-3.5 w-3.5" aria-label="Enviado" /> : null}
            </span>
          </div>
        ) : null}
      </div>
      ) : null}
    </li>
  );
}

function OutboundBubbleView({
  job,
  onRetry,
  onDiscard,
  onRestore,
  onReview,
}: {
  job: OutboundSend;
  onRetry: () => void;
  onDiscard: () => void;
  onRestore: () => void;
  onReview?: () => void;
}) {
  const caption = bubbleCaption(job.state, job.reason);
  return (
    <li className="text-right">
      <div className="inline-block max-w-[70%] rounded-3xl bg-[#e3edff] px-4 py-2.5 text-left text-[15px] leading-relaxed shadow-[0_1px_2px_rgba(29,36,51,0.06)]">
        {job.vault.length > 0 ? <VaultThumbRow creatorId={job.creatorId} pieces={job.vault} /> : null}
        {job.body ? <p>{job.body}</p> : null}
      </div>
      {job.priceLabel ? <p className="mt-1 text-[10px] text-[#6d7585]">Precio {job.priceLabel}</p> : null}
      {caption ? <p className="mt-1 text-[10px] text-[#8a5a12]">{caption}</p> : null}
      {job.state === "error" ? (
        <p className="mt-1 flex justify-end gap-2 text-[10px]">
          {job.reason === "Envío en seco" ? null : <button type="button" className="text-[#2456c7]" onClick={onRetry}>Reintentar</button>}
          <button type="button" className="text-[#2456c7]" onClick={onDiscard}>Descartar</button>
          {job.reason === "Envío en seco" ? null : <button type="button" className="text-[#2456c7]" onClick={onRestore}>Recuperar</button>}
        </p>
      ) : null}
      {job.state === "awaiting" && onReview ? (
        <p className="mt-1 flex justify-end text-[10px]">
          <button type="button" className="text-[#2456c7]" onClick={onReview}>Marcar como revisado</button>
        </p>
      ) : null}
    </li>
  );
}

export function RealChatsPage() {
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const setCreator = useCrm((s) => s.setCreator);
  const crmFans = useCrm((s) => s.fans);
  const scripts = useCrm((s) => s.scripts);
  const vault = useCrm((s) => s.vault);
  const saveNote = useCrm((s) => s.saveNote);
  const teamAccess = useCrm((s) => s.teamAccess);
  const user = useCurrentUser();
  const [data, setData] = useState<CreatorChatList | null>(null);
  const rememberedInbox = typeof window === "undefined" ? null : readInboxCreator(window.localStorage);
  const inboxScope = inboxCreators(creators, data?.accounts ?? []);
  const inboxCreator = resolveInboxCreator({
    requested: creatorId,
    creators: inboxScope,
    remembered: rememberedInbox,
  });
  const noticeBadges = useCreatorNoticeBadges(creators.map((creator) => creator.id));
  const noticeCount = inboxCreator ? noticeBadges[inboxCreator] ?? 0 : 0;
  useEffect(() => {
    if (!inboxCreator || inboxCreator === creatorId) return;
    writeInboxCreator(window.localStorage, inboxCreator);
    setCreator(inboxCreator);
  }, [inboxCreator, creatorId, setCreator]);
  const [error, setError] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [filter, setFilter] = useState<InboxPill>("todos");
  const [fetchedSpend, setFetchedSpend] = useState<Record<string, number | null>>({});
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineFans, setOnlineFans] = useState<OnlineFanRow[]>([]);
  const [onlineNote, setOnlineNote] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [onlineSend, setOnlineSend] = useState<{ enabled: boolean; reason: string | null }>({ enabled: false, reason: "Envío a todos desactivado" });
  const [onlineCap, setOnlineCap] = useState(100);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [insightsTab, setInsightsTab] = useState<"Insights" | "Ventas" | "Notas">("Insights");
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [flagOverrides, setFlagOverrides] = useState<Record<string, import("../../server/of-sessions/sync/fan-flags.ts").FanFlag>>({});
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [tagHandle, setTagHandle] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [fanMenu, setFanMenu] = useState(false);
  const [marks, setMarks] = useState<{ hidden: string[]; muted: string[] }>({ hidden: [], muted: [] });
  const [showHidden, setShowHidden] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [fanAction, setFanAction] = useState<null | "lists" | "discount" | "restrict" | "block" | "report">(null);
  const [fanBusy, setFanBusy] = useState(false);
  const [fanActionError, setFanActionError] = useState<string | null>(null);
  const [fanLists, setFanLists] = useState<Array<{ name: string; on: boolean }>>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteFilter, setNoteFilter] = useState<NotificationTab>("all");
  const [noteCursor, setNoteCursor] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [noteCounts, setNoteCounts] = useState<NotificationCounts | null>(null);
  const [noteNotice, setNoteNotice] = useState<string | null>(null);
  const [purchaseNote, setPurchaseNote] = useState<NoteRow | null>(null);
  const notesButton = useRef<HTMLButtonElement>(null);
  const notesLive = useRef<{ seq: number; creatorId: string | null; tab: NotificationTab }>({ seq: 0, creatorId: null, tab: "all" });
  const [notesPos, setNotesPos] = useState({ top: 0, left: 0 });
  const [discountPercent, setDiscountPercent] = useState("10");
  const [reportText, setReportText] = useState("");
  const [draft, setDraft] = useState("");
  const [draftPrice, setDraftPrice] = useState<number | null>(null);
  const [priceLabel, setPriceLabel] = useState<string | null>(null);
  const [sendCreators, setSendCreators] = useState<string[]>([]);
  const jobList = useSyncExternalStore(chatSendSession.subscribe, chatSendSession.getJobs, chatSendSession.getJobs);
  const [pendingOut, setPendingOut] = useState<Array<{ id: string; creatorId: string; threadKey: string; body: string; scheduledAt: string | null; authorName: string | null; authorId: string | null; priceCents: number | null; vault: Array<{ id: string; name: string }>; status: "pending" | "error" | "sending"; stale: boolean; errorReason: string | null; dedupeKey: string | null; matchedMessageKey: string | null }>>([]);
  const [scheduleAt, setScheduleAt] = useState("");
  const [panel, setPanel] = useState<ComposerPanel>(null);
  const [dialog, setDialog] = useState<"precio" | "programar" | null>(null);
  const [textSize, setTextSize] = useState<"sm" | "base" | "lg">("base");
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const [fanTranslation, setFanTranslation] = useState(false);
  const draftBox = useRef<HTMLDivElement>(null);
  const fileBox = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const olderLock = useRef(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [threadHistory, setThreadHistory] = useState<Record<string, { done: boolean; messages: NonNullable<CreatorChatList["messages"]> }>>({});
  const listLock = useRef(false);
  const pendingRef = useRef(pendingOut);
  const threadBox = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [ofVault, setOfVault] = useState<Array<{ id: string; title: string; kind: "foto" | "video" | "audio" | "gif" | null }>>([]);
  const [vaultReload, setVaultReload] = useState(0);
  const [vaultReading, setVaultReading] = useState(false);
  const vaultPage = useRef({ listId: "all", offset: 0, busy: false });
  const vaultGen = useRef(0);
  const vaultPending = useRef<{ listId: string; offset: number } | null>(null);
  function takeVaultPending() {
    const pending = vaultPending.current;
    vaultPending.current = null;
    return pending;
  }
  const [thumbPage, setThumbPage] = useState({ listId: "all", offset: 0 });
  const vaultMemory = useRef<Record<string, string>>({});
  const vaultCreator = useRef<string | null>(null);
  const vaultThread = useRef<string | null>(null);
  const offerPriceId = useRef<string | null>(null);
  // Hilo abierto: la lista trae sus mensajes recientes completos. El resto va resumido.
  const openThreadRef = useRef<{ creatorId: string; threadKey: string } | null>(null);

  async function refresh() {
    try {
      const list = await listCreatorChats({ data: { open: openThreadRef.current } });
      setData(list);
      const nextPending = list.pending.flatMap((item) => (
        item.threadKey ? [{
          id: item.id,
          creatorId: item.creatorId,
          threadKey: item.threadKey,
          body: item.body,
          scheduledAt: item.scheduledAt,
          authorName: item.authorName,
          authorId: item.authorId,
          priceCents: item.priceCents,
          vault: item.vault ?? [],
          status: item.status,
          stale: item.stale,
          errorReason: item.errorReason,
          dedupeKey: item.dedupeKey,
          matchedMessageKey: item.matchedMessageKey ?? null,
        }] : []
      ));
      pendingRef.current = nextPending;
      setPendingOut(nextPending);
      chatSendSession.noteMatches(confirmedMatches(nextPending));
      setError(null);
    } catch (err) {
      setError(sessionErrorText(err));
    }
  }

  useEffect(() => {
    void refresh();
    void chatSendAccess().then((access) => setSendCreators(access.creatorIds)).catch(() => setSendCreators([]));
    setMarks(readChatMarks());
    const timer = setInterval(() => { void refresh(); }, 5_000);
    return () => clearInterval(timer);
  }, []);

  async function loadNotes(tab: NotificationTab = noteFilter, cursor: string | null = null) {
    const creator = inboxCreator;
    const requestId = notesLive.current.seq + 1;
    notesLive.current.seq = requestId;
    notesLive.current.creatorId = creator;
    notesLive.current.tab = tab;
    const ids = creator ? [creator] : [];
    if (ids.length === 0) {
      if (!notesResponseApplies({
        requestId,
        creatorId: "",
        tab,
        currentId: notesLive.current.seq,
        currentCreatorId: notesLive.current.creatorId,
        currentTab: notesLive.current.tab,
      })) return;
      setNotes([]);
      setNoteCounts(null);
      setNoteCursor(null);
      setNoteNotice(null);
      return;
    }
    const pages = await Promise.all(ids.map(async (id) => {
      try {
        const page = await listCreatorNotifications({ data: { creatorId: id, tab, cursor } });
        return { id, page };
      } catch {
        return { id, page: null };
      }
    }));
    if (!creator || !notesResponseApplies({
      requestId,
      creatorId: creator,
      tab,
      currentId: notesLive.current.seq,
      currentCreatorId: notesLive.current.creatorId,
      currentTab: notesLive.current.tab,
    })) return;
    setNoteCounts(pages.length === 1 ? pages[0]?.page?.counts ?? null : null);
    setNoteCursor(pages.length === 1 ? pages[0]?.page?.nextCursor ?? null : null);
    const notices = pages.flatMap((entry) => entry.page?.sessionNotice ? [entry.page.sessionNotice] : []);
    setNoteNotice(notices.length > 0 ? notices.join(" · ") : null);
    const incoming = pages.flatMap((entry) => entry.page?.items.map((item) => ({ ...item, creatorId: entry.id })) ?? [])
      .sort((left, right) => (right.occurredAt ?? "").localeCompare(left.occurredAt ?? ""));
    setNotes((current) => cursor ? [...(current ?? []), ...incoming] : incoming);
  }

  useEffect(() => {
    notesLive.current.seq += 1;
    notesLive.current.creatorId = inboxCreator;
    notesLive.current.tab = "all";
    setNoteFilter("all");
    setNotes(null);
    setNoteCursor(null);
    setNoteCounts(null);
    setNoteNotice(null);
    void loadNotes("all", null);
    const timer = setInterval(() => {
      void loadNotes(notesLive.current.tab, null);
    }, 20_000);
    return () => clearInterval(timer);
  }, [inboxCreator, creators.length]);

  useEffect(() => {
    const pending = peekOpenThread();
    if (!pending || !data) return;
    const thread = data.threads.find((row) => row.creatorId === pending.creatorId && (
      (pending.threadKey != null && row.threadKey === pending.threadKey)
      || (pending.fanKey != null && (row.fanKey === pending.fanKey || row.threadKey === pending.fanKey))
    ));
    if (!thread) return;
    clearOpenThread();
    chooseThread(thread);
  }, [data]);

  function markNotes(rows: NoteRow[]) {
    const unread = rows.filter((item) => !item.seen);
    if (unread.length === 0) return;
    const chosen = new Set(unread.map((item) => `${item.creatorId}:${item.key}`));
    setNotes((current) => current?.map((item) => (chosen.has(`${item.creatorId}:${item.key}`) ? { ...item, seen: true } : item)) ?? current);
    const groups = new Map<string, string[]>();
    for (const item of unread) {
      const list = groups.get(item.creatorId) ?? [];
      list.push(item.key);
      groups.set(item.creatorId, list);
    }
    for (const [id, keys] of groups) {
      void markCreatorNotificationsRead({ data: { creatorId: id, keys } }).then((result) => {
        if (result.counts && id === inboxCreator) setNoteCounts(result.counts);
      }).catch(() => undefined);
    }
  }

  // Verla es leerla: con el panel abierto, lo que sigue a la vista 2 s se marca leído.
  useEffect(() => {
    if (!notesOpen || !notes) return;
    const unread = panelNotes(notes, inboxCreator, noteFilter).filter((item) => !item.seen);
    if (unread.length === 0) return;
    const timer = window.setTimeout(() => markNotes(unread), 2_000);
    return () => window.clearTimeout(timer);
  }, [notesOpen, notes, noteFilter, inboxCreator]);

  function placeNotes() {
    const rect = notesButton.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 440;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setNotesPos({ top: rect.bottom + 8, left });
  }

  function openNote(item: NoteRow) {
    markNotes([item]);
    const pool = threads;
    const thread = pool.find((row) => row.creatorId === item.creatorId && (
      (item.threadKey != null && row.threadKey === item.threadKey)
      || (item.fanKey != null && (row.fanKey === item.fanKey || row.threadKey === item.fanKey || row.fanHandle?.replace(/^@/, "") === item.fanKey))
    ));
    if (!thread) return;
    chooseThread(thread);
    setNotesOpen(false);
  }

  async function loadOnlineFans() {
    const creator = inboxCreator;
    if (!creator) {
      setOnlineFans([]);
      setOnlineCount(null);
      setOnlineNote("Elige una cuenta");
      setOnlineSend({ enabled: false, reason: "Elige una cuenta" });
      return;
    }
    setOnlineBusy(true);
    setOnlineNote(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        listOnlineFans({ data: { creatorId: creator } }),
        new Promise<{ fans: []; reason: string; notices: string[]; cap: number; send: { enabled: boolean; reason: string | null } }>((resolve) => {
          timer = setTimeout(() => resolve({ fans: [], reason: "No se pudo leer.", notices: [], cap: onlineCap, send: { enabled: false, reason: "Envío a todos desactivado" } }), 25_000);
        }),
      ]);
      const rows = result.fans.map((fan) => ({
        fanKey: fan.fanKey,
        fanName: fan.fanName,
        fanHandle: fan.fanHandle,
        avatarUrl: "avatarUrl" in fan ? fan.avatarUrl : null,
        spentCents: "spentCents" in fan ? fan.spentCents : null,
        currency: "currency" in fan ? fan.currency : null,
        online: "online" in fan ? fan.online : false,
        lists: "lists" in fan ? fan.lists : [],
      }));
      setOnlineFans(rows);
      const notice = result.notices.length > 0 ? result.notices.join(" · ") : null;
      const failed = rows.length === 0 && result.reason != null && result.reason !== "Nadie en línea";
      setOnlineCount(failed ? null : rows.length);
      setOnlineNote(notice ?? (rows.length === 0 ? result.reason ?? "Nadie en línea" : null));
      setOnlineSend(result.send);
      if (typeof result.cap === "number") setOnlineCap(result.cap);
    } catch (err) {
      setOnlineFans([]);
      setOnlineCount(null);
      setOnlineNote(sessionErrorText(err));
      setOnlineSend({ enabled: false, reason: "Envío a todos desactivado" });
    } finally {
      if (timer) clearTimeout(timer);
      setOnlineBusy(false);
    }
  }

  async function toggleOnline() {
    const next = !onlineOpen;
    setOnlineOpen(next);
    if (!next) return;
    await loadOnlineFans();
  }

  async function sendAllOnline(payload: OnlineBroadcastPayload) {
    const creator = inboxCreator;
    if (!creator) return { posted: 0, results: [], stopped: false, retryAfter: null, reason: "Elige una cuenta", cap: onlineCap };
    return broadcastOnlineFans({ data: { creatorId: creator, ...payload } });
  }

  async function cancelAllOnline(batchId: string) {
    const creator = inboxCreator;
    if (!creator) return;
    await cancelOnlineBroadcast({ data: { creatorId: creator, batchId } });
  }

  function openOnlineFan(fanKey: string) {
    const creator = inboxCreator;
    const thread = threads.find((row) => creator != null && row.creatorId === creator && (row.fanKey === fanKey || row.threadKey === fanKey));
    if (thread) chooseThread(thread);
    setOnlineOpen(false);
  }

  const threads = inboxThreadList(data?.threads ?? [], {
    requested: creatorId,
    creators: inboxScope,
    remembered: rememberedInbox,
  }).threads;
  const flags = applyFlagOverrides(data?.flags ?? [], flagOverrides);
  const accountMessages = rowsForCreator(data?.messages ?? [], inboxCreator);
  const scopeIds = inboxCreator ? [inboxCreator] : [];
  const sessionRows = rowsForCreator(data?.accounts ?? [], inboxCreator);
  const viewBlocked = everyAccountBlocked(sessionRows, scopeIds);
  const sessionNotices = (data?.sessionNotices ?? []).filter((notice) => inboxCreator != null && notice.startsWith(`${inboxCreator}:`));
  const countedThreads = threads.filter((thread) => !sessionRows.some((row) => row.creatorId === thread.creatorId && accountFigure(row, 0) === SESSION_EXPIRED_LABEL));
  const pills = inboxPillCounts({
    status: viewBlocked ? "error" : error ? "error" : data ? "ready" : "loading",
    threads: viewBlocked ? [] : countedThreads,
    messages: viewBlocked ? null : data ? accountMessages : null,
    ofUnread: viewBlocked || !inboxCreator ? null : data?.ofChatUnread?.find((row) => row.creatorId === inboxCreator)?.count ?? null,
  });
  const tipped = tipThreads(accountMessages, threads);
  const inbox = useInboxSelection({
    threads: threads.map((thread) => ({ ...thread, id: `${thread.creatorId}:${thread.threadKey}` })),
    matches: (thread) => matchesInboxPill(thread, filter, tipped),
    hidden: (thread) => marks.hidden.includes(threadMark(thread.creatorId, thread.threadKey)),
    showHidden,
    pinnedAt: (thread) => (thread.fanKey ? flags.find((item) => item.creatorId === thread.creatorId && item.fanKey === thread.fanKey)?.pinnedAt ?? null : null),
    onMark: (thread) => {
      void markChatOpened({ data: { creatorId: thread.creatorId, threadKey: thread.threadKey } }).then((result) => {
        if (result.marked) void refresh();
      }).catch(() => undefined);
    },
  });
  const selected = inbox.selected;
  const threadVaultId = selected ? `${selected.creatorId}:${selected.threadKey}` : null;
  if (threadVaultId !== vaultThread.current) {
    const nextCreator = chatVaultCreator(selected, inboxCreator);
    const moved = vaultFolderOnAccountChange(vaultMemory.current, vaultCreator.current, nextCreator, thumbPage.listId);
    const restarted = chatVaultOnThreadChange({
      previousThreadId: vaultThread.current,
      nextThreadId: threadVaultId,
      generation: vaultGen.current,
    });
    vaultMemory.current = moved.memory;
    vaultCreator.current = nextCreator;
    vaultThread.current = threadVaultId;
    vaultGen.current = restarted.generation;
    vaultPending.current = null;
    vaultPage.current = { listId: moved.listId, offset: 0, busy: false };
    setOfVault([]);
    if (thumbPage.listId !== moved.listId || thumbPage.offset !== 0) {
      setThumbPage({ listId: moved.listId, offset: 0 });
    }
  }
  const visible = inbox.visible;
  const onlineKeys = onlineFans.flatMap((fan) => (fan.online ? [fan.fanKey] : []));
  const presenceNow = Date.now();
  const fanCards = useChatFanCards([
    ...threads,
    ...(notes ?? []).flatMap((item) => item.creatorId === inboxCreator && item.fanKey ? [{ creatorId: item.creatorId, fanKey: item.fanKey }] : []),
  ]);
  const spendAsked = useRef("");
  const spendTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [spendTick, setSpendTick] = useState(0);
  const spendCreator = inboxCreator;
  const spendCardIds = visible.flatMap((thread) => {
    if (!spendCreator || thread.creatorId !== spendCreator || !thread.fanKey) return [];
    const card = chatFanCardFor(fanCards.fans, thread.creatorId, thread.fanKey)?.spentCents ?? null;
    return card == null ? [] : [thread.fanKey];
  });
  const spendMissing = visible.flatMap((thread) => {
    if (!spendCreator || thread.creatorId !== spendCreator || !thread.fanKey || !/^\d{1,20}$/.test(thread.fanKey)) return [];
    const card = chatFanCardFor(fanCards.fans, thread.creatorId, thread.fanKey)?.spentCents ?? null;
    const fetched = fetchedSpend[`${thread.creatorId}:${thread.fanKey}`];
    if (rowSpendCents(thread.spentCents, card, fetched === undefined ? null : fetched) != null) return [];
    if (fetched !== undefined) return [];
    return [thread.fanKey];
  });
  const spendIds = [...new Set(spendMissing)].slice(0, 10).sort();
  const spendKey = spendCreator ? `${spendCreator}:${spendIds.join(",")}:${[...new Set(spendCardIds)].sort().join(",")}` : "";
  useEffect(() => {
    if (!spendCreator || spendIds.length === 0) return;
    if (spendAsked.current === spendKey) return;
    spendAsked.current = spendKey;
    const ids = spendIds;
    const creator = spendCreator;
    void readVisibleFanSpend({ data: { creatorId: creator, fanIds: ids, cardIds: spendCardIds } }).then((result) => {
      if (result.retryAfterMs > 0) {
        spendAsked.current = "";
        if (spendTimer.current) clearTimeout(spendTimer.current);
        spendTimer.current = setTimeout(() => setSpendTick((tick) => tick + 1), result.retryAfterMs);
      }
      setFetchedSpend((current) => {
        const next = { ...current };
        for (const id of ids) {
          if (!(id in result.byFan)) continue;
          next[`${creator}:${id}`] = result.byFan[id] ?? null;
        }
        return next;
      });
    }).catch(() => {
      spendAsked.current = "";
    });
  }, [spendKey, spendTick]);
  useEffect(() => () => {
    if (spendTimer.current) clearTimeout(spendTimer.current);
  }, []);
  openThreadRef.current = selected ? { creatorId: selected.creatorId, threadKey: selected.threadKey } : null;
  const historyKey = selected ? `${selected.creatorId}:${selected.threadKey}` : "";
  const storedHistory = historyKey ? threadHistory[historyKey] : undefined;
  const messages = mergeHistoryMessages(
    (data?.messages ?? []).filter((message) => message.creatorId === selected?.creatorId && message.threadKey === selected?.threadKey),
    storedHistory?.messages ?? [],
  );
  const historyDone = storedHistory?.done === true;
  const findKeys = findOpen ? findMessages(messages, findQuery) : [];
  const activeFindKey = findOpen ? findKeys[findIndex] ?? null : null;
  const openedThread = selected ? `${selected.creatorId}:${selected.threadKey}` : null;
  useEffect(() => {
    setGalleryOpen(false);
    setFindOpen(false);
    setFindQuery("");
    setFindIndex(0);
    setFlashKey(null);
  }, [openedThread]);
  const meta = data?.meta.find((item) => item.creatorId === selected?.creatorId);
  const running = selected ? data?.runningCreatorIds.includes(selected.creatorId) : false;
  const syncPhase = chatPhase(data, creatorId === "all" ? selected?.creatorId ?? null : creatorId, Boolean(running));
  const canForce = teamAccess?.role === "owner" && selected != null;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (dialog != null || insightsOpen || galleryOpen) return;
      inbox.onArrow(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, insightsOpen, galleryOpen, inbox.onArrow]);
  useEffect(() => {
    if (dialog == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialog(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);
  useEffect(() => {
    if (!insightsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInsightsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [insightsOpen]);
  useEffect(() => {
    const params = new URLSearchParams();
    if (selected?.creatorId) params.set("creatorId", selected.creatorId);
    if (selected?.threadKey) params.set("threadKey", selected.threadKey);
    const source = new EventSource(`/api/chat-live?${params.toString()}`);
    source.addEventListener("chats", () => {
      void refresh();
    });
    return () => source.close();
  }, [selected?.creatorId, selected?.threadKey]);
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!chatSendSession.shouldWarn()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);
  useEffect(() => {
    chatSendSession.setHolds(holdsForUser(pendingOut, user?.id ?? null));
  }, [pendingOut, user?.id]);
  useEffect(() => {
    return chatSendSession.subscribe(() => {
      const jobs = chatSendSession.getJobs();
      if (jobs.some((job) => job.state === "sent" || job.state === "awaiting")) void refresh();
    });
  }, []);
  const openThread = selected ? `${selected.creatorId}:${selected.threadKey}` : null;
  const threadTail = `${messages.at(-1)?.messageKey ?? ""}:${jobList.map((job) => `${job.clientId}:${job.state}`).join(",")}:${pendingOut.length}`;
  useEffect(() => {
    if (!selected) return;
    const key = `${selected.creatorId}:${selected.threadKey}`;
    let stop = false;
    void readThreadHistory({ data: { creatorId: selected.creatorId, threadKey: selected.threadKey } }).then((page) => {
      if (stop) return;
      setThreadHistory((current) => keepThread(current, key, page.messages as NonNullable<CreatorChatList["messages"]>, page.done));
    }).catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [selected?.creatorId, selected?.threadKey]);
  useEffect(() => {
    if (!historyKey) return;
    const live = (data?.messages ?? []).filter((message) => message.creatorId === selected?.creatorId && message.threadKey === selected?.threadKey);
    setThreadHistory((current) => keepThread(current, historyKey, live, null));
  }, [historyKey, data?.messages, selected?.creatorId, selected?.threadKey]);
  const confirmMark = `${jobList.map((job) => job.state === "sent" || job.state === "awaiting" ? `${job.clientId}:${job.state}:${job.messageId ?? ""}` : "").join()}|${pendingOut.map((item) => item.matchedMessageKey ? `${item.id}:${item.matchedMessageKey}` : "").join()}`;
  useEffect(() => {
    if (!selected || confirmMark === "|") return;
    const key = `${selected.creatorId}:${selected.threadKey}`;
    const creatorId = selected.creatorId;
    const threadKey = selected.threadKey;
    let stop = false;
    void readThreadHistory({ data: { creatorId, threadKey } }).then((page) => {
      if (stop) return;
      setThreadHistory((current) => keepThread(current, key, page.messages as NonNullable<CreatorChatList["messages"]>, page.done));
    }).catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [confirmMark, selected?.creatorId, selected?.threadKey]);
  const stickBottom = useStickToBottom({
    box: threadBox,
    stick: stickToBottom,
    threadKey: openThread,
    tail: `${threadTail}:${messages.length}`,
  });
  const headerOnline = selected ? fanShowsOnline(selected.online, selected.lastSeenAt, presenceNow, fanListedOnline(onlineKeys, selected.fanKey, selected.threadKey)) : false;
  const headerSeen = selected ? lastSeenLabel(selected.lastSeenAt, presenceNow, headerOnline) : null;
  const watermarkHandle = creators.find((creator) => creator.id === selected?.creatorId)?.handle?.trim() || null;
  const creatorName = creators.find((creator) => creator.id === inboxCreator)?.name ?? "Cuenta";
  const slash = slashQuery(draft);
  const scriptHits = matchScripts(scripts, slash != null ? slash : libraryQuery);
  const showScripts = panel === "guiones" || slash != null;
  const realSend = selected != null && sendCreators.includes(selected.creatorId);
  const vaultAttachmentRows = attachments.filter((file) => file.kind === "vault");
  const vaultPreviewCount = vaultAttachmentRows.filter((file) => file.free === true).length;
  const ppvBlocked = ppvPreviewMissing(draftPrice, vaultAttachmentRows.length, vaultPreviewCount);
  const sendBlockedReason = !selected
    ? "Elige un hilo"
    : !draft.trim()
      ? "Escribe un mensaje"
      : !realSend
        ? REAL_SEND_OFF_REASON
        : attachments.some((file) => file.kind !== "vault")
          ? "Quita los archivos locales pendientes"
          : ppvBlocked
            ? "Falta una vista previa gratis"
            : null;
  const threadCreator = chatVaultCreator(selected, inboxCreator);
  const vaultItems = rowsForCreator(vault, threadCreator);
  const tagCreators = creators.filter((creator) => creator.id !== selected?.creatorId && creator.handle.trim() !== "");

  function toggle(next: ComposerPanel) {
    setDialog(null);
    setPanel((current) => current === next ? null : next);
  }

  function replaceDraft(text: string) {
    const node = draftBox.current;
    if (node) node.textContent = text;
    setDraft(text);
  }

  function rememberSelection() {
    const node = draftBox.current;
    const selection = window.getSelection();
    if (!node || !selection || selection.rangeCount === 0 || !node.contains(selection.anchorNode)) return;
    savedRange.current = selection.getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    const node = draftBox.current;
    const range = savedRange.current;
    node?.focus();
    if (!node || !range) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function formatCommand(command: "bold" | "italic" | "foreColor", value?: string) {
    const node = draftBox.current;
    restoreSelection();
    if (command === "foreColor" && value) document.execCommand("styleWithCSS", false, "true");
    const applied = document.execCommand(command, false, value);
    if (!applied && command !== "foreColor" && node) {
      const offsets = selectionOffsets(node);
      const next = wrapSelection(draftPlain(node), offsets.start, offsets.end, command === "bold" ? "*" : "_");
      replaceDraft(next.value);
      return;
    }
    if (node) setDraft(draftPlain(node));
  }

  function clearComposer() {
    const files = attachments;
    replaceDraft("");
    setDraftPrice(null);
    setPriceLabel(null);
    setAttachments([]);
    setTagHandle(null);
    setError(null);
    for (const file of files) {
      if (file.url) URL.revokeObjectURL(file.url);
    }
  }

  function commitSend(key: string, shiftKey: boolean, composing: boolean) {
    if (key === "Enter" && !shiftKey && !composing && !selected) {
      setComposerError("Elige un hilo");
      return;
    }
    if (!selected && key === "Enter" && !shiftKey && !composing) return;
    const localFiles = attachments.filter((file) => file.kind !== "vault");
    if (key === "Enter" && !shiftKey && !composing && localFiles.length > 0) {
      setComposerError("Los archivos locales siguen pendientes. El vault de OnlyFans sí se adjunta.");
      return;
    }
    const vault = attachments.filter((file) => file.kind === "vault").map((file) => ({
      id: file.id.replace(/^vault-/, ""),
      name: file.name,
      free: file.free === true,
    }));
    const freePreviews = vault.filter((file) => file.free).length;
    if (key === "Enter" && !shiftKey && !composing && ppvPreviewMissing(draftPrice, vault.length, freePreviews)) {
      setComposerError("PPV de pago: marca al menos un vídeo como Gratis (vista previa).");
      return;
    }
    const decision = chatSendSession.press({
      key,
      shiftKey,
      composing,
      realSend,
      body: (draftBox.current ? draftPlain(draftBox.current) : draft).trim(),
      creatorId: selected?.creatorId ?? "",
      threadKey: selected?.threadKey ?? "",
      fanKey: selected?.fanKey ?? null,
      priceCents: draftPrice,
      priceLabel,
      vault,
      tagHandle,
    });
    if (decision.action === "blocked") {
      setComposerError(decision.reason);
      return;
    }
    if (decision.action === "duplicate") {
      setComposerError("Ya enviaste este mensaje hace un momento.");
      return;
    }
    if (decision.action === "ignored") {
      setComposerError("No se pudo encolar el mensaje. Comprueba el hilo y el texto.");
      return;
    }
    if (decision.action === "queued") {
      setComposerError(null);
      clearComposer();
    }
  }

  function restoreDraft(source: { body: string; priceCents: number | null; priceLabel: string | null; vault: Array<{ id: string; name: string }> }) {
    const next = draftFromRejected(source);
    replaceDraft(next.body);
    setDraftPrice(next.priceCents);
    setPriceLabel(next.priceLabel);
    setAttachments((current) => {
      for (const file of current) {
        if (file.url) URL.revokeObjectURL(file.url);
      }
      return next.vault.map((item) => ({
        id: `vault-${item.id}`,
        url: null,
        name: item.name,
        kind: "vault" as const,
        free: item.free !== false,
      }));
    });
  }

  async function resolveStale(id: string, outcome: "sent" | "error") {
    try {
      await resolveOnlineOutbound({ data: { id, outcome } });
      await refresh();
    } catch (err) {
      setError(sessionErrorText(err));
    }
  }

  function retrySend(clientId: string) {
    const local = chatSendSession.getJobs().find((job) => job.clientId === clientId);
    if (local) {
      chatSendSession.retry(clientId);
      return;
    }
    const item = pendingRef.current.find((row) => row.id === clientId && row.status === "error" && row.authorId === user?.id);
    if (!item || item.dedupeKey) return;
    const recovered = draftFromPending(item);
    const job: OutboundSend = {
      clientId: item.id,
      creatorId: item.creatorId,
      threadKey: item.threadKey,
      fanKey: selected?.fanKey ?? null,
      body: recovered.body,
      priceCents: recovered.priceCents,
      priceLabel: recovered.priceLabel,
      vault: recovered.vault,
      tagHandle,
      at: 0,
      state: "queued",
      messageId: null,
      reason: null,
    };
    chatSendSession.retry(clientId, job);
  }

  async function discardSend(clientId: string) {
    try {
      await discardChatOutbound({ data: { clientId } });
    } catch (err) {
      chatSendSession.noteFailure(clientId, sessionErrorText(err));
      return;
    }
    const nextPending = pendingRef.current.filter((item) => item.id !== clientId);
    pendingRef.current = nextPending;
    setPendingOut(nextPending);
    chatSendSession.setHolds(holdsForUser(nextPending, user?.id ?? null));
    chatSendSession.remove(clientId);
    await refresh();
  }

  async function reviewSend(clientId: string) {
    try {
      await reviewChatOutbound({ data: { clientId } });
    } catch (err) {
      setError(sessionErrorText(err));
      return;
    }
    chatSendSession.remove(clientId);
    await refresh();
  }

  async function loadOfVault(listId = "all", offset = 0) {
    setPanel("vault");
    if (!selected) return;
    if (!vaultLoadAllowed(vaultPage.current, { listId, offset })) {
      vaultPending.current = { listId, offset };
      return;
    }
    vaultPending.current = null;
    const generation = vaultGen.current + 1;
    vaultGen.current = generation;
    const requestCreatorId = selected.creatorId;
    if (offset === 0 && listId !== vaultPage.current.listId) setOfVault([]);
    vaultPage.current = { listId, offset, busy: true };
    setVaultReading(true);
    const stillCurrent = () => vaultReadApplies({
      generation,
      currentGeneration: vaultGen.current,
      requestCreatorId,
      activeCreatorId: vaultCreator.current,
    });
    try {
      const result = await readChatVault({ data: { creatorId: requestCreatorId, threadKey: selected.threadKey, listId, offset } });
      if (!stillCurrent()) return;
      setOfVault((current) => offset === 0 ? result.items : mergeVaultPage(current, result.items));
      setVaultReload((value) => value + 1);
      setThumbPage({ listId, offset });
      const step = result.nextOffset > offset ? result.nextOffset : offset + 40;
      vaultPage.current = { listId, offset: result.hasMore ? step : -1, busy: false };
      if (offset === 0 && result.items.length === 0 && listId === "all") setError(result.reason ?? "La bóveda de OnlyFans ha llegado vacía.");
      if (offset === 0 && result.items.length === 0 && listId !== "all" && result.reason === VAULT_FOLDER_READ_ERROR) setError(result.reason);
    } catch (err) {
      if (!stillCurrent()) return;
      vaultPage.current = { listId, offset, busy: false };
      if (offset === 0) setOfVault([]);
      setError(sessionErrorText(err));
    } finally {
      if (stillCurrent()) {
        setVaultReading(false);
        const pending = takeVaultPending();
        if (pending) void loadOfVault(pending.listId, pending.offset);
      }
    }
  }

  function savePending(scheduledAt: string | null) {
    if (!selected || !draft.trim()) return;
    const body = draft.trim();
    const price = draftPrice;
    const label = priceLabel;
    const files = attachments;
    replaceDraft("");
    setDraftPrice(null);
    setPriceLabel(null);
    setScheduleAt("");
    setPanel(null);
    setDialog(null);
    setAttachments([]);
    void recordChatOutbound({
      data: {
        creatorId: selected.creatorId,
        fanKey: selected.fanKey,
        threadKey: selected.threadKey,
        body,
        priceCents: price,
        ofMessageKey: null,
        scheduledAt,
      },
    }).then(() => {
      for (const file of files) {
        if (file.url) URL.revokeObjectURL(file.url);
      }
      return refresh();
    }).catch((err: unknown) => {
      replaceDraft(body);
      setDraftPrice(price);
      setPriceLabel(label);
      setAttachments(files);
      setError(sessionErrorText(err));
    });
  }

  function insertAtCursor(token: string) {
    const node = draftBox.current;
    if (!node) {
      setDraft(`${draft}${token}`);
      return;
    }
    restoreSelection();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !node.contains(selection.anchorNode)) {
      node.append(document.createTextNode(token));
    } else {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const text = document.createTextNode(token);
      range.insertNode(text);
      range.setStartAfter(text);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      savedRange.current = range.cloneRange();
    }
    setDraft(draftPlain(node));
  }

  function addFiles(files: File[]) {
    setAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        url: URL.createObjectURL(file),
        name: file.name,
        kind: file.type.startsWith("video/") ? "video" as const : "image" as const,
      })),
    ]);
    setPanel(null);
  }

  function attachVault(item: { id: string; title: string; creatorId?: string | null; withId?: string | null; withTitle?: string | null; withCreatorId?: string | null; seconds?: number | null; offerLabel?: string | null; dateLabel?: string | null }) {
    const paired = Boolean(item.withId && item.withId !== item.id);
    const pieces = acceptedVaultPieces(threadCreator, [
      { id: item.id, title: item.title, creatorId: item.creatorId ?? null, seconds: item.seconds ?? null, offerLabel: item.offerLabel ?? null, dateLabel: item.dateLabel ?? null },
      ...(paired
        ? [{ id: item.withId ?? "", title: item.withTitle || "", creatorId: item.withCreatorId ?? item.creatorId ?? null, seconds: null, offerLabel: null, dateLabel: null }]
        : []),
    ]);
    if (pieces.length === 0) return;
    const priced = draftPrice != null && draftPrice > 0;
    setAttachments((current) => {
      const next = [...current];
      for (const piece of pieces) {
        if (next.some((file) => file.id === `vault-${piece.id}`)) continue;
        const paidHalf = paired && piece.id === item.withId;
        const free = paidHalf ? false : paired ? true : !priced;
        next.push({ id: `vault-${piece.id}`, url: null, name: vaultPieceName(piece.title), kind: "vault" as const, free, seconds: piece.seconds, offerLabel: piece.offerLabel, dateLabel: piece.dateLabel });
      }
      return next;
    });
    if (paired && !priced && item.withId) {
      offerPriceId.current = `vault-${item.withId}`;
      setDialog("precio");
    }
    setPanel(null);
  }

  function toggleVaultOffer(id: string) {
    const file = attachments.find((item) => item.id === id);
    if (!file || file.kind !== "vault") return;
    const toPaid = file.free !== false;
    if (toPaid && (draftPrice == null || draftPrice <= 0)) {
      offerPriceId.current = id;
      setPanel(null);
      setDialog("precio");
      return;
    }
    setAttachments((current) => current.map((item) => item.id === id ? { ...item, free: !toPaid } : item));
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const hit = current.find((file) => file.id === id);
      if (hit?.url) URL.revokeObjectURL(hit.url);
      return current.filter((file) => file.id !== id);
    });
  }

  function chooseThread(thread: { creatorId: string; threadKey: string }) {
    inbox.choose({ id: `${thread.creatorId}:${thread.threadKey}` });
  }

  function fanNickname(creatorId: string, fanKey: string | null): string | null {
    if (!fanKey) return null;
    return (data?.profiles ?? []).find((item) => item.creatorId === creatorId && item.fanKey === fanKey)?.nickname ?? null;
  }

  function fanTitle(thread: { creatorId: string; fanKey: string | null; fanName: string | null; fanHandle: string | null }): string {
    return fanNickname(thread.creatorId, thread.fanKey) || thread.fanName || thread.fanHandle || "Fan";
  }

  function flagFor(thread: { creatorId: string; fanKey: string | null }) {
    return thread.fanKey ? flags.find((item) => item.creatorId === thread.creatorId && item.fanKey === thread.fanKey) ?? null : null;
  }

  function isMuted(thread: { creatorId: string; fanKey: string | null; threadKey: string }): boolean {
    return flagFor(thread)?.muted === true || marks.muted.includes(threadMark(thread.creatorId, thread.threadKey));
  }

  /** Favorito, avisos y fijado. Solo del CRM: se guardan en la base y los ve todo el equipo. No llaman a OnlyFans. */
  function setFlag(patch: { favorite?: boolean; muted?: boolean; pinned?: boolean }) {
    if (!selected?.fanKey) return;
    const target = { creatorId: selected.creatorId, fanKey: selected.fanKey };
    const key = flagKey(target);
    const next = patchedFlag(flagFor(selected), target, patch, new Date().toISOString());
    // La lista y el icono cambian al pulsar; el servidor confirma después.
    setFlagOverrides((current) => ({ ...current, [key]: next }));
    const settle = () => setFlagOverrides((current) => {
      if (current[key] !== next) return current;
      const { [key]: _done, ...rest } = current;
      return rest;
    });
    void saveFanFlag({ data: { ...target, patch } })
      .then(() => refresh())
      .then(settle, (err: unknown) => { setError(sessionErrorText(err)); settle(); void refresh(); });
  }

  function toggleMuted() {
    if (!selected) return;
    const next = !isMuted(selected);
    const id = threadMark(selected.creatorId, selected.threadKey);
    if (!next && marks.muted.includes(id)) saveMarks({ ...marks, muted: marks.muted.filter((item) => item !== id) });
    setFlag({ muted: next });
  }

  function startRename() {
    if (!selected) return;
    setRenameValue(fanNickname(selected.creatorId, selected.fanKey) ?? "");
    setRenaming(true);
    setFanMenu(true);
  }

  function jumpToMessage(messageKey: string) {
    setFlashKey(messageKey);
    setTimeout(() => {
      const el = threadBox.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageKey)}"]`);
      if (el) {
        stickToBottom.current = false;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 0);
    setTimeout(() => setFlashKey((current) => (current === messageKey ? null : current)), 2500);
  }

  function saveMarks(next: { hidden: string[]; muted: string[] }) {
    setMarks(next);
    localStorage.setItem(CHAT_MARKS_KEY, JSON.stringify(next));
  }

  function toggleMark(kind: "hidden" | "muted") {
    if (kind === "muted") { toggleMuted(); return; }
    if (!selected) return;
    const id = threadMark(selected.creatorId, selected.threadKey);
    const has = marks[kind].includes(id);
    const next = { ...marks, [kind]: has ? marks[kind].filter((item) => item !== id) : [...marks[kind], id] };
    saveMarks(next);
    if (kind === "hidden" && !has) {
      const other = visible.find((thread) => {
        const mark = threadMark(thread.creatorId, thread.threadKey);
        return mark !== id && !next.hidden.includes(mark);
      });
      if (other) inbox.choose({ id: `${other.creatorId}:${other.threadKey}` });
    }
    setFanMenu(false);
  }

  function saveRename() {
    if (!selected?.fanKey) return;
    const current = (data?.profiles ?? []).find((item) => item.creatorId === selected.creatorId && item.fanKey === selected.fanKey);
    const nickname = renameValue.trim();
    void saveFanProfile({
      data: {
        creatorId: selected.creatorId,
        fanKey: selected.fanKey,
        nickname: nickname || null,
        birthday: current?.birthday ?? null,
        timezone: current?.timezone ?? null,
        source: current?.source ?? null,
        salaryCents: current?.salaryCents ?? null,
        lastPayDate: current?.lastPayDate ?? null,
      },
    }).then(() => refresh()).catch((err: unknown) => setError(sessionErrorText(err)));
    setRenaming(false);
    setFanMenu(false);
  }

  function runMenu(request: { action: "lists" } | { action: "list"; name: string } | { action: "discount"; percent: number } | { action: "restrict" } | { action: "block" } | { action: "report"; reason: string }) {
    if (!selected?.fanKey) return;
    setFanBusy(true);
    setFanActionError(null);
    void runFanChatMenu({ data: { creatorId: selected.creatorId, fanKey: selected.fanKey, request } }).then((result) => {
      const answer = result as { ok: boolean; reason: string | null; lists: Array<{ name: string; on: boolean }> };
      setFanLists(answer.lists ?? []);
      if (!answer.ok) {
        setFanActionError(answer.reason ?? "No se ha podido hacer en OnlyFans.");
        return;
      }
      if (request.action !== "lists" && request.action !== "list") {
        setFanAction(null);
        setFanMenu(false);
      }
    }).catch((err: unknown) => setFanActionError(sessionErrorText(err))).finally(() => setFanBusy(false));
  }

  return (
    <div className="absolute inset-0 flex min-h-0 overflow-hidden bg-white text-[#1c2333]">
      <section className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-[#e6e8ee] md:w-[340px] md:shrink-0">
        <div className="shrink-0 space-y-3 border-b border-[#e6e8ee] px-3 py-3">
          <h1 className="truncate text-sm font-semibold uppercase tracking-wide">{creatorName}</h1>
          <div className="flex gap-2">
            <div className="relative">
              <button type="button" onClick={() => void toggleOnline()} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${onlineOpen ? "bg-[#3b6cff] text-white" : "bg-[#eef2ff] text-[#2456c7]"}`}>Fans en línea{onlineCount == null ? "" : ` ${onlineCount}`}</button>
              {onlineOpen ? (
                <OnlineFansPanel
                  busy={onlineBusy}
                  note={onlineNote}
                  fans={onlineFans}
                  sendEnabled={onlineSend.enabled}
                  sendReason={onlineSend.reason}
                  onRefresh={() => void loadOnlineFans()}
                  onOpenChat={openOnlineFan}
                  cap={onlineCap}
                  onSend={sendAllOnline}
                  onCancel={(batchId) => void cancelAllOnline(batchId)}
                />
              ) : null}
            </div>
            <button
              ref={notesButton}
              type="button"
              className="relative inline-flex items-center gap-1.5 rounded-lg bg-[#1f9d55] px-3 py-1.5 text-xs font-medium text-white"
              onClick={() => { placeNotes(); setNotesOpen((open) => !open); if (inboxCreator) void ensureNoticeTab({ data: { creatorId: inboxCreator, tab: noteFilter } }).catch(() => undefined); void loadNotes(); }}
            >
              <Bell className="h-3.5 w-3.5" />
              Notificaciones
              {noticeCount > 0 ? <span className="min-w-5 rounded-full bg-white px-1 text-center text-[10px] font-semibold tabular-nums text-[#1f9d55]" aria-label={`${noticeCount} notificaciones`}>{noticeCount}</span> : null}
            </button>
            {notesOpen ? createPortal(
              <>
                <button type="button" aria-label="Cerrar notificaciones" className="fixed inset-0 z-40 cursor-default" onClick={() => setNotesOpen(false)} />
                <div className="fixed z-50 flex max-h-[min(560px,70vh)] w-[440px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl border border-[#e6e8ee] bg-white shadow-xl" style={{ top: notesPos.top, left: notesPos.left }}>
                  <div className="flex items-center justify-between px-4 py-3">
                    <h2 className="text-base font-semibold">Notificaciones</h2>
                    <button type="button" aria-label="Actualizar notificaciones" className="grid h-8 w-8 place-items-center rounded-full text-[#6d7585] hover:bg-[#f4f7ff]" onClick={() => void loadNotes()}><RefreshCw className="h-4 w-4" /></button>
                  </div>
                  <NoteTabRow filter={noteFilter} counts={noteCounts} onSelect={(id) => { setNoteFilter(id); if (inboxCreator) void ensureNoticeTab({ data: { creatorId: inboxCreator, tab: id } }).catch(() => undefined); void loadNotes(id, null); }} />
                  {ofTabListNote({ tab: noteFilter, unread: noteCounts?.[noteFilter] ?? null, listed: panelNotes(notes, inboxCreator, noteFilter).length }) ? (
                    <p className="px-4 pb-2 text-[11px] text-[#6d7585]">{ofTabListNote({ tab: noteFilter, unread: noteCounts?.[noteFilter] ?? null, listed: panelNotes(notes, inboxCreator, noteFilter).length })}</p>
                  ) : null}
                  <ul className="min-h-0 flex-1 divide-y divide-[#eceff3] overflow-y-auto px-4">
                    {noteNotice ? <li className="py-6 text-sm text-[#8a5a12]">{noteNotice}</li> : null}
                    {notes == null && !noteNotice ? <li className="py-6 text-sm text-[#6d7585]">Sin datos</li> : null}
                    {notes != null && !noteNotice && panelNotes(notes, inboxCreator, noteFilter).length === 0 ? <li className="py-6 text-sm text-[#6d7585]">Sin notificaciones</li> : null}
                    {panelNotes(notes, inboxCreator, noteFilter).map((item) => {
                      const thread = notesForCreator(data?.threads ?? [], inboxCreator).find((row) => row.creatorId === item.creatorId && (
                        (item.threadKey != null && row.threadKey === item.threadKey)
                        || (item.fanKey != null && (row.fanKey === item.fanKey || row.threadKey === item.fanKey || row.fanHandle?.replace(/^@/, "") === item.fanKey))
                      ));
                      const handle = item.fanHandle ?? thread?.fanHandle?.replace(/^@/, "") ?? null;
                      const card = chatFanCardFor(fanCards.fans, item.creatorId, item.fanKey);
                      const face = noticeFace({
                        avatarUrl: item.avatarUrl,
                        renewAuto: item.renewAuto ?? null,
                        threadAvatar: thread?.avatarUrl ?? null,
                        threadRenew: thread?.renewAuto ?? null,
                        cardRenew: card?.renewAuto ?? null,
                      });
                      const reply = notificationReplyLine({
                        creatorId: item.creatorId,
                        fanKey: item.fanKey,
                        occurredAt: item.occurredAt,
                        messages: accountMessages,
                      });
                      return (
                        <li key={`${item.creatorId}:${item.key}`}>
                          <NotificationFanCard
                            item={item}
                            handle={handle}
                            avatarUrl={face.avatarUrl}
                            renew={face.renewAuto}
                            reply={reply}
                            onChat={thread && notificationOpensChat(item.kind) ? () => openNote(item) : undefined}
                            onSeen={item.seen ? undefined : () => markNotes([item])}
                            onMessage={item.kind === "ppv" && item.messageRef ? () => setPurchaseNote(item) : undefined}
                          />
                        </li>
                      );
                    })}
                  </ul>
                  {noteCursor ? (
                    <button type="button" className="border-t border-[#eceff3] px-4 py-3 text-left text-sm text-[#2456c7]" onClick={() => void loadNotes(noteFilter, noteCursor)}>Cargar más</button>
                  ) : null}
                </div>
              </>,
              document.body,
            ) : null}
            {purchaseNote?.messageRef ? (
              <PurchaseMessageDialog
                creatorId={purchaseNote.creatorId}
                creatorName={creators.find((creator) => creator.id === purchaseNote.creatorId)?.name ?? "Cuenta"}
                fanKey={purchaseNote.fanKey}
                threadKey={purchaseNote.threadKey}
                messageRef={purchaseNote.messageRef}
                onClose={() => setPurchaseNote(null)}
                onCompose={(mode) => {
                  const thread = (data?.threads ?? []).find((row) => row.creatorId === purchaseNote.creatorId && (
                    (purchaseNote.threadKey != null && row.threadKey === purchaseNote.threadKey)
                    || (purchaseNote.fanKey != null && (row.fanKey === purchaseNote.fanKey || row.threadKey === purchaseNote.fanKey))
                  ));
                  if (thread) chooseThread(thread);
                  const draftText = purchaseComposeDraft(mode, scripts.map((script) => ({ body: script.steps[0]?.text ?? "" })));
                  setPurchaseNote(null);
                  setNotesOpen(false);
                  requestAnimationFrame(() => {
                    if (draftText.text) replaceDraft(draftText.text);
                    draftBox.current?.focus();
                  });
                }}
              />
            ) : null}
          </div>
          <div className="flex gap-2">
            {([
              ["todos", "Todos", pills.todos],
              ["sin-leer", "Sin leer", pills.sinLeer],
              ["propinas", "Con propinas", pills.propinas],
            ] as const).map(([id, label, count]) => (
              <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded-full px-3 py-1 text-xs ${filter === id ? "bg-[#3b6cff] text-white" : "bg-[#f3f4f6] text-[#6d7585]"}`} aria-pressed={filter === id}>
                {label} {viewBlocked ? "" : count == null ? "· Sin datos" : accountFigure({ sessionRejected: false, connection: "live" }, count)}
              </button>
            ))}
            {sessionNotices.length > 0 && !viewBlocked ? <p className="w-full text-[10px] text-[#8a5a12]">{sessionNotices.join(" · ")}</p> : null}
            {marks.hidden.length > 0 ? (
              <button type="button" onClick={() => setShowHidden((open) => !open)} className={`rounded-full px-3 py-1 text-xs ${showHidden ? "bg-[#3b6cff] text-white" : "bg-[#f3f4f6] text-[#6d7585]"}`}>Ocultos {marks.hidden.length}</button>
            ) : null}
          </div>
        </div>
        {error ? <p className="shrink-0 px-4 text-sm text-[#8a5a12]">{error}</p> : null}
        <div className="min-h-0 flex-1 overflow-y-auto" onScroll={(event) => {
          const node = event.currentTarget;
          if (node.scrollHeight - node.scrollTop - node.clientHeight > 48 || listLock.current) return;
          const creator = inboxCreator;
          if (!creator) return;
          listLock.current = true;
          void loadMoreChats({ data: { creatorId: creator } }).then(() => refresh()).catch(() => undefined).finally(() => {
            listLock.current = false;
          });
        }}>
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[#6d7585]">{viewBlocked ? SESSION_EXPIRED_LABEL : sessionNotices.length > 0 && threads.length === 0 ? sessionNotices.join(" · ") : threads.length === 0 ? syncPhaseLabel(syncPhase) : "Sin datos"}</p>
        ) : (
          <ul>
            {visible.map((thread) => {
              const unread = unreadChatRow(thread.unread);
              const online = fanShowsOnline(thread.online, thread.lastSeenAt, presenceNow, fanListedOnline(onlineKeys, thread.fanKey, thread.threadKey));
              const seen = lastSeenLabel(thread.lastSeenAt, presenceNow, online);
              return (
              <li key={`${thread.creatorId}:${thread.threadKey}`}>
                <button
                  type="button"
                  onClick={() => chooseThread(thread)}
                  className={`flex w-full gap-3 px-3 py-3 text-left ${selected?.threadKey === thread.threadKey && selected.creatorId === thread.creatorId ? "bg-[#f4f7ff]" : ""}`}
                >
                  <span className="flex w-12 shrink-0 flex-col items-center gap-1">
                    <FanFace name={fanTitle(thread)} url={thread.avatarUrl} online={online} />
                    <FanSpendLabel
                      thread={thread.spentCents}
                      card={chatFanCardFor(fanCards.fans, thread.creatorId, thread.fanKey)?.spentCents ?? null}
                      fetched={thread.fanKey ? fetchedSpend[`${thread.creatorId}:${thread.fanKey}`] ?? null : null}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className={`truncate text-sm ${unread.bold ? "font-bold text-[#1d2433]" : "font-medium"}`}>{fanTitle(thread)}</span>
                      {flagFor(thread)?.pinnedAt ? <Pin className="h-3 w-3 shrink-0 text-[#2456c7]" aria-label="Fijado" /> : null}
                      {flagFor(thread)?.favorite ? <Star className="h-3 w-3 shrink-0 text-[#f5a300]" fill="currentColor" aria-label="Favorito" /> : null}
                      {isMuted(thread) ? <BellOff className="h-3 w-3 shrink-0 text-[#8a93a3]" aria-label="Avisos silenciados" /> : null}
                      {unread.badge != null && !isMuted(thread) ? <span className="shrink-0 rounded-full bg-[#3b6cff] px-1.5 text-[10px] font-semibold text-white" aria-label={`${unread.badge} sin leer`}>{unread.badge}</span> : null}
                      {thread.online === false && !online && !seen ? <span className="rounded bg-[#f3f4f6] px-1 text-[10px] text-[#6d7585]">OFF</span> : null}
                    </span>
                    <span className="flex items-baseline gap-2 text-xs text-[#6d7585]">
                      <span className="truncate">{thread.fanHandle ? `@${thread.fanHandle.replace(/^@/, "")}` : "Sin datos"}</span>
                      {seen ? <span className="shrink-0 truncate">{seen}</span> : null}
                    </span>
                    <span className="mt-1 flex items-baseline justify-between gap-2 text-xs text-[#6d7585]">
                      <span className={`truncate ${unread.bold ? "font-bold text-[#1d2433]" : ""}`}>{thread.excerpt ?? "Sin datos"}</span>
                      <span className="shrink-0">{thread.lastMessageAt ? madridClock(thread.lastMessageAt) : "Sin datos"}</span>
                    </span>
                  </span>
                </button>
              </li>
              );
            })}
          </ul>
        )}
        </div>
      </section>
      <section className="hidden h-full min-h-0 min-w-0 flex-1 md:flex">
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative flex shrink-0 items-center justify-between gap-3 border-b border-[#e6e8ee] px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                {selected ? <FanFace name={fanTitle(selected)} url={selected.avatarUrl} online={headerOnline} /> : null}
                <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1">
                <button type="button" className="block max-w-full truncate text-left text-lg font-semibold tracking-[-0.01em]" onClick={() => { setFanMenu((open) => !open); setRenaming(false); }} aria-expanded={fanMenu} aria-label="Opciones del fan">
                  {selected ? fanTitle(selected) : syncPhaseLabel(syncPhase)}
                </button>
                {selected?.fanKey ? <button type="button" aria-label="Renombrar fan" title="Renombrar (solo en el CRM)" className="shrink-0 rounded p-1 text-[#8a93a3] transition-colors hover:text-[#1d2433]" onClick={startRename}><Pencil className="h-3.5 w-3.5" /></button> : null}
                </div>
                {selected ? (
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center text-xs text-[#6d7585]">
                    {headerOnline ? (
                      <span className="inline-flex items-center gap-1.5 font-medium text-[#1d2433]"><span className="h-2 w-2 rounded-full bg-[#22c55e]" aria-hidden />Disponible ahora</span>
                    ) : headerSeen ? <span className="truncate">{headerSeen}</span> : null}
                    {selected.fanKey ? (
                      <>
                        <span className="mx-1.5 h-4 w-px shrink-0 bg-[#e3e7ee]" aria-hidden />
                        <button type="button" aria-label="Favorito" aria-pressed={flagFor(selected)?.favorite === true} title="Favorito (CRM)" className={`rounded p-1 text-[#8a93a3] transition-colors hover:text-[#1d2433] ${flagFor(selected)?.favorite ? "!text-[#f5a300]" : ""}`} onClick={() => setFlag({ favorite: !(flagFor(selected)?.favorite === true) })}><Star className="h-4 w-4" fill={flagFor(selected)?.favorite ? "currentColor" : "none"} /></button>
                        <span className="mx-1.5 h-4 w-px shrink-0 bg-[#e3e7ee]" aria-hidden />
                        <button type="button" aria-label={isMuted(selected) ? "Activar avisos" : "Silenciar avisos"} aria-pressed={isMuted(selected)} title={isMuted(selected) ? "Avisos silenciados (CRM)" : "Silenciar avisos (CRM)"} className={`rounded p-1 text-[#8a93a3] transition-colors hover:text-[#1d2433] ${isMuted(selected) ? "!text-[#b42318]" : ""}`} onClick={toggleMuted}>{isMuted(selected) ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}</button>
                        <span className="mx-1.5 h-4 w-px shrink-0 bg-[#e3e7ee]" aria-hidden />
                        <button type="button" aria-label="Nota" title="Nota de la creadora" className="rounded p-1 text-[#8a93a3] transition-colors hover:text-[#1d2433]" onClick={() => { setInsightsTab("Notas"); setInsightsOpen(true); }}><StickyNote className="h-4 w-4" /></button>
                        <span className="mx-1.5 h-4 w-px shrink-0 bg-[#e3e7ee]" aria-hidden />
                        <button type="button" aria-label={flagFor(selected)?.pinnedAt ? "Desfijar chat" : "Fijar chat"} aria-pressed={Boolean(flagFor(selected)?.pinnedAt)} title="Fijar arriba de la lista (CRM)" className={`rounded p-1 text-[#8a93a3] transition-colors hover:text-[#1d2433] ${flagFor(selected)?.pinnedAt ? "!text-[#2456c7]" : ""}`} onClick={() => setFlag({ pinned: !flagFor(selected)?.pinnedAt })}><Pin className="h-4 w-4" fill={flagFor(selected)?.pinnedAt ? "currentColor" : "none"} /></button>
                      </>
                    ) : null}
                    <span className="mx-1.5 h-4 w-px shrink-0 bg-[#e3e7ee]" aria-hidden />
                    <button type="button" className="inline-flex items-center gap-1 rounded p-1 text-[#8a93a3] transition-colors hover:text-[#1d2433]" onClick={() => setGalleryOpen(true)}><Images className="h-4 w-4" aria-hidden /><span className="text-xs">Galería</span></button>
                    <span className="mx-1.5 h-4 w-px shrink-0 bg-[#e3e7ee]" aria-hidden />
                    <button type="button" className="inline-flex items-center gap-1 rounded p-1 text-[#8a93a3] transition-colors hover:text-[#1d2433]" aria-pressed={findOpen} onClick={() => setFindOpen((open) => !open)}><Search className="h-4 w-4" aria-hidden /><span className="text-xs">Encontrar</span></button>
                  </div>
                ) : null}
                </div>
                {fanMenu && selected ? (
                  <>
                    <button type="button" aria-label="Cerrar opciones del fan" className="fixed inset-0 z-20 cursor-default" onClick={() => { setFanMenu(false); setRenaming(false); }} />
                    <div className="absolute right-4 top-full z-30 mt-1 w-72 rounded-xl border border-[#e6e8ee] bg-white py-1 text-sm shadow-lg">
                      <div className="flex items-center gap-2 border-b border-[#e6e8ee] px-4 py-3">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#eef2ff] text-xs font-medium">{fanTitle(selected).slice(0, 1)}</span>
                        <span className="min-w-0 truncate text-[#6d7585]">{selected.fanHandle ? `@${selected.fanHandle.replace(/^@/, "")}` : "Sin usuario"}</span>
                      </div>
                      {renaming ? (
                        <form className="space-y-2 px-4 py-3" onSubmit={(event) => { event.preventDefault(); saveRename(); }}>
                          <input aria-label="Apodo" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className="h-9 w-full rounded-lg border border-[#e6e8ee] px-2 text-sm" placeholder="Apodo" />
                          <div className="flex justify-end gap-2">
                            <button type="button" className="text-xs text-[#6d7585]" onClick={() => setRenaming(false)}>Cancelar</button>
                            <button type="submit" className="text-xs font-medium text-[#2456c7]" disabled={!selected.fanKey}>Guardar</button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <FanLink item="Copiar enlace del perfil" href={profileHref(selected.fanHandle)} copied={copiedLink === "perfil"} onCopy={(href) => { void navigator.clipboard.writeText(href); setCopiedLink("perfil"); }} />
                          <FanLink item="Copiar enlace del chat" href={chatHref(selected.fanKey)} copied={copiedLink === "chat"} onCopy={(href) => { void navigator.clipboard.writeText(href); setCopiedLink("chat"); }} />
                          <button type="button" className="block w-full px-4 py-3 text-left hover:bg-[#f4f7ff] disabled:text-[#b0b6c0]" disabled={!selected.fanKey} onClick={() => { setRenameValue(fanNickname(selected.creatorId, selected.fanKey) ?? selected.fanName ?? ""); setRenaming(true); }}>Renombrar</button>
                          <div className="my-1 border-t border-[#e6e8ee]" />
                          <button type="button" className="block w-full px-4 py-3 text-left hover:bg-[#f4f7ff]" onClick={() => toggleMark("hidden")}>{marks.hidden.includes(threadMark(selected.creatorId, selected.threadKey)) ? "Mostrar chat" : "Ocultar chat"}</button>
                          <button type="button" className="block w-full px-4 py-3 text-left text-[#2456c7] hover:bg-[#f4f7ff]" onClick={() => { toggleMuted(); setFanMenu(false); }}>{isMuted(selected) ? "Activar avisos" : "Silenciar avisos"}</button>
                          <div className="my-1 border-t border-[#e6e8ee]" />
                          {fanAction ? (
                            <div className="px-4 py-3">
                              <button type="button" className="text-xs text-[#6d7585]" onClick={() => { setFanAction(null); setFanActionError(null); }}>Volver</button>
                              {fanAction === "lists" ? (
                                <div className="mt-2 space-y-1">
                                  {fanBusy && fanLists.length === 0 ? <p className="text-xs text-[#6d7585]">Leyendo las listas de OnlyFans…</p> : null}
                                  {fanLists.map((item) => (
                                    <button key={item.name} type="button" disabled={fanBusy} className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-[#f4f7ff] disabled:opacity-50" onClick={() => runMenu({ action: "list", name: item.name })}>
                                      {item.on ? "Quitar de" : "Añadir a"} {item.name}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              {fanAction === "discount" ? (
                                <form className="mt-2 space-y-2" onSubmit={(event) => { event.preventDefault(); const percent = Number(discountPercent); if (Number.isInteger(percent) && percent >= 1 && percent <= 100) runMenu({ action: "discount", percent }); }}>
                                  <p className="text-xs text-[#6d7585]">Porcentaje en OnlyFans, del 1 al 100.</p>
                                  <input aria-label="Porcentaje de descuento" value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} inputMode="numeric" className="h-9 w-full rounded-lg border border-[#e6e8ee] px-2 text-sm" />
                                  <button type="submit" disabled={fanBusy} className="text-sm font-medium text-[#2456c7] disabled:opacity-50">Aplicar</button>
                                </form>
                              ) : null}
                              {fanAction === "restrict" || fanAction === "block" ? (
                                <div className="mt-2 space-y-2">
                                  <p className="text-xs text-[#6d7585]">Esto se hace en la cuenta de OnlyFans.</p>
                                  <button type="button" disabled={fanBusy} className="text-sm font-medium text-[#2456c7] disabled:opacity-50" onClick={() => runMenu({ action: fanAction })}>{fanAction === "block" ? "Bloquear" : "Restringir"}</button>
                                </div>
                              ) : null}
                              {fanAction === "report" ? (
                                <form className="mt-2 space-y-2" onSubmit={(event) => { event.preventDefault(); if (reportText.trim()) runMenu({ action: "report", reason: reportText.trim() }); }}>
                                  <textarea aria-label="Motivo de la denuncia" value={reportText} onChange={(event) => setReportText(event.target.value)} className="h-20 w-full rounded-lg border border-[#e6e8ee] px-2 py-1 text-sm" />
                                  <button type="submit" disabled={fanBusy || !reportText.trim()} className="text-sm font-medium text-[#2456c7] disabled:opacity-50">Denunciar</button>
                                </form>
                              ) : null}
                              {fanActionError ? <p className="mt-2 text-xs text-[#8a5a12]">{fanActionError}</p> : null}
                            </div>
                          ) : (
                            <>
                              <button type="button" disabled={!selected.fanKey || fanBusy} className="block w-full px-4 py-3 text-left hover:bg-[#f4f7ff] disabled:text-[#b0b6c0]" onClick={() => { setFanAction("lists"); setFanLists([]); setFanActionError(null); runMenu({ action: "lists" }); }}>Añadir o quitar de listas</button>
                              <button type="button" disabled={!selected.fanKey || fanBusy} className="block w-full px-4 py-3 text-left hover:bg-[#f4f7ff] disabled:text-[#b0b6c0]" onClick={() => { setFanAction("discount"); setFanActionError(null); }}>Dar un descuento</button>
                              <button type="button" disabled={!selected.fanKey || fanBusy} className="block w-full px-4 py-3 text-left hover:bg-[#f4f7ff] disabled:text-[#b0b6c0]" onClick={() => { setFanAction("restrict"); setFanActionError(null); }}>Restringir</button>
                              <button type="button" disabled={!selected.fanKey || fanBusy} className="block w-full px-4 py-3 text-left hover:bg-[#f4f7ff] disabled:text-[#b0b6c0]" onClick={() => { setFanAction("block"); setFanActionError(null); }}>Bloquear</button>
                              <button type="button" disabled={!selected.fanKey || fanBusy} className="block w-full px-4 py-3 text-left hover:bg-[#f4f7ff] disabled:text-[#b0b6c0]" onClick={() => { setFanAction("report"); setFanActionError(null); }}>Denunciar</button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {selected ? <button type="button" className="rounded-lg px-2.5 py-1 text-xs font-medium text-[#6d7585] hover:bg-[#f1f4fa] hover:text-[#1d2433]" onClick={() => { setInsightsTab("Insights"); setInsightsOpen(true); }}>Ficha del fan</button> : null}
                <button type="button" aria-label="Recargar" title="Recargar" className="rounded-full p-2 text-[#6d7585] hover:bg-[#f1f4fa] hover:text-[#1d2433]" onClick={() => { setRefreshSpin(true); void Promise.resolve(refresh()).finally(() => setTimeout(() => setRefreshSpin(false), 400)); }}><RefreshCw className={`h-4 w-4 ${refreshSpin ? "animate-spin" : ""}`} aria-hidden /></button>
                <button type="button" aria-label="Menú" title="Menú" className="rounded-full p-2 text-[#6d7585] hover:bg-[#f1f4fa] hover:text-[#1d2433]" onClick={() => { setFanMenu((open) => !open); setRenaming(false); }} aria-expanded={fanMenu}><EllipsisVertical className="h-4 w-4" aria-hidden /></button>
              </div>
            </header>
            {findOpen && selected ? (
              <ChatFindBar
                query={findQuery}
                onQuery={(value) => { setFindQuery(value); setFindIndex(0); const keys = findMessages(messages, value); if (keys.length > 0) jumpToMessage(keys[0]); }}
                count={findKeys.length}
                index={findIndex}
                onStep={(direction) => { const next = stepMatch(findIndex, findKeys.length, direction); setFindIndex(next); if (findKeys[next]) jumpToMessage(findKeys[next]); }}
                onClose={() => { setFindOpen(false); setFindQuery(""); setFindIndex(0); }}
              />
            ) : null}
            {menu && selected ? (
              <div className="shrink-0 border-b border-[#e6e8ee] px-4 py-2 text-xs text-[#6d7585]">
                {headerSyncLabel(syncPhase)}
                {meta?.syncedAt ? ` · ${syncAge(meta.syncedAt)}` : ""}
                {canForce ? (
                  <button
                    type="button"
                    disabled={pending || running}
                    onClick={() => {
                      setPending(true);
                      void syncCreatorChats({ data: { creatorId: selected.creatorId } })
                        .then(() => refresh())
                        .catch((err: unknown) => setError(sessionErrorText(err)))
                        .finally(() => setPending(false));
                    }}
                    className="ml-3 rounded border border-[#e6e8ee] px-2 py-1 disabled:opacity-50"
                  >
                    {pending || running ? "Sincronizando…" : "Forzar sincronización"}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="relative min-h-0 flex-1">
            {olderBusy ? <p className="pointer-events-none absolute inset-x-0 top-2 z-10 text-center text-xs text-[#6d7585]">Cargando mensajes anteriores…</p> : null}
            <ol ref={threadBox} data-thread-scroll style={{ scrollBehavior: "auto" }} {...stickBottom.intent} onLoadCapture={stickBottom.follow} onLoadedMetadataCapture={stickBottom.follow} className="h-full space-y-4 overflow-y-auto [overflow-anchor:none] bg-[#fbfcfe] px-[max(1rem,calc((100%-760px)/2))] py-6" onScroll={(event) => {
              const node = event.currentTarget;
              stickBottom.noteScroll(node);
              if (node.scrollTop > 24 || !selected || olderLock.current || historyDone) return;
              olderLock.current = true;
              setOlderBusy(true);
              const creatorId = selected.creatorId;
              const threadKey = selected.threadKey;
              const key = `${creatorId}:${threadKey}`;
              const pull = async () => {
                const page = await loadOlderMessages({ data: { creatorId, threadKey } });
                if (page.retryAfterMs > 0) {
                  await new Promise((resolve) => setTimeout(resolve, page.retryAfterMs));
                  return loadOlderMessages({ data: { creatorId, threadKey } });
                }
                return page;
              };
              void pull().then(async (page) => {
                const stored = await readThreadHistory({ data: { creatorId, threadKey } }).catch(() => null);
                setThreadHistory((current) => keepThread(
                  current,
                  key,
                  (stored?.messages ?? []) as NonNullable<CreatorChatList["messages"]>,
                  stored?.done ?? !page.hasMore,
                ));
                void refresh();
              }).catch(() => undefined).finally(() => {
                olderLock.current = false;
                setOlderBusy(false);
              });
            }}>
              {historyDone ? <li className="text-center text-xs text-[#6d7585]">Inicio de la conversación</li> : null}
              {!selected || (messages.length === 0 && pendingForThread(unmatchedPending(pendingOut), selected).length === 0 && jobList.every((job) => job.creatorId !== selected.creatorId || job.threadKey !== selected.threadKey)) ? <li className="text-sm text-[#6d7585]">{selected ? "Sin datos" : syncPhaseLabel(syncPhase)}</li> : null}
              {withDateSeparators(messages, Date.now()).map(({ message, separator }) => (
                <Fragment key={message.messageKey}>
                  {separator ? (
                    <li className="flex items-center gap-3 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[#8a93a3]" data-date-separator={separator} aria-label={separator}>
                      <span className="h-px flex-1 bg-[#e3e7ee]" />
                      <span>{separator}</span>
                      <span className="h-px flex-1 bg-[#e3e7ee]" />
                    </li>
                  ) : null}
                  <ThreadMessage message={message} watermark={watermarkHandle} find={findOpen || flashKey === message.messageKey ? { query: findOpen ? findQuery : "", active: activeFindKey === message.messageKey, flash: flashKey === message.messageKey } : undefined} />
                </Fragment>
              ))}
              {pendingBesideLocal(pendingForThread(unmatchedPending(pendingOut), selected), jobList).map((item) => {
                const recovered = draftFromPending(item);
                const mine = item.authorId != null && item.authorId === user?.id;
                return (
                  <li key={item.id} className="text-right">
                    {item.vault.length > 0 ? <VaultThumbRow creatorId={item.creatorId} pieces={item.vault} /> : null}
                    <p className="inline-block max-w-[70%] rounded-2xl border border-dashed border-[#c5cad6] px-3 py-2 text-sm">{item.body}</p>
                    {recovered.priceLabel ? <p className="mt-1 text-[10px] text-[#6d7585]">Precio {recovered.priceLabel}</p> : null}
                    <p className="mt-1 text-[10px] text-[#8a5a12]">{item.status === "error" ? bubbleCaption("error", item.errorReason) : pendingCaption(item)}</p>
                    {item.status === "sending" && item.stale ? (
                      <p className="mt-1 flex justify-end gap-2 text-[10px]">
                        <button type="button" className="text-[#2456c7]" onClick={() => void resolveStale(item.id, "sent")}>Salió</button>
                        <button type="button" className="text-[#2456c7]" onClick={() => void resolveStale(item.id, "error")}>No salió</button>
                      </p>
                    ) : null}
                    {item.status === "error" && mine ? (
                      <p className="mt-1 flex justify-end gap-2 text-[10px]">
                        {item.dedupeKey || item.errorReason === "Envío en seco" ? null : <button type="button" className="text-[#2456c7]" onClick={() => retrySend(item.id)}>Reintentar</button>}
                        <button type="button" className="text-[#2456c7]" onClick={() => void discardSend(item.id)}>Descartar</button>
                        {item.dedupeKey || item.errorReason === "Envío en seco" ? null : <button type="button" className="text-[#2456c7]" onClick={() => restoreDraft(recovered)}>Recuperar</button>}
                      </p>
                    ) : null}
                    {item.errorReason === "Pendiente de confirmar" && teamAccess?.role === "owner" ? (
                      <p className="mt-1 flex justify-end text-[10px]">
                        <button type="button" className="text-[#2456c7]" onClick={() => void reviewSend(item.id)}>Marcar como revisado</button>
                      </p>
                    ) : null}
                  </li>
                );
              })}
              {reconcileBubbles(jobList, messages).filter((job) => selected && job.creatorId === selected.creatorId && job.threadKey === selected.threadKey).map((job) => (
                <OutboundBubbleView key={job.clientId} job={job} onRetry={() => retrySend(job.clientId)} onDiscard={() => void discardSend(job.clientId)} onRestore={() => restoreDraft(job)} onReview={job.state === "awaiting" && teamAccess?.role === "owner" ? () => void reviewSend(job.clientId) : undefined} />
              ))}
              {messages.some((message) => message.fromFan) && fanTranslation ? <li className="text-[10px] text-[#6d7585]">Traducción: Sin datos</li> : null}
            </ol>
            </div>
            <form className="relative shrink-0 border-t border-[#e6e8ee] px-[max(0.5rem,calc((100%-760px)/2))] py-3" onSubmit={(event) => event.preventDefault()}>
              {panel && panel !== "guiones" && panel !== "vault" && panel !== "etiqueta" ? (
                <div role="region" aria-label={panelLabel(panel)} className="absolute inset-x-2 bottom-full z-20 mb-1 max-h-52 overflow-y-auto rounded-xl border border-[#e6e8ee] bg-white p-3 text-sm shadow-lg">
                  <ComposerPanelBody
                    panel={panel}
                    vaultItems={vaultItems}
                    tagCreators={tagCreators}
                    tagQuery={tagQuery}
                    onTagQuery={setTagQuery}
                    fanTranslation={fanTranslation}
                    textSize={textSize}
                    ofVault={ofVault}
                    vaultReload={vaultReload}
                    creatorId={threadCreator ?? ""}
                    fanKey={selected?.fanKey ?? null}
                    onReadVault={() => void loadOfVault()}
                    onVault={attachVault}
                    onTag={(handle) => { const name = handle.replace(/^@/, "").trim(); setTagHandle(name || null); insertAtCursor(mentionToken(handle)); setPanel(null); }}
                    onFormat={formatCommand}
                    onSize={setTextSize}
                    onFanTranslation={() => setFanTranslation((value) => !value)}
                    onEmoji={insertAtCursor}
                  />
                </div>
              ) : null}
              {panel === "vault" ? (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-[3vmin]">
                  <div className="flex h-[94vh] w-[94vw] min-h-0 flex-col overflow-hidden rounded-2xl border border-[#e6e8ee] bg-white shadow-xl">
                    <ComposerPanelBody
                      panel={panel}
                      vaultItems={vaultItems}
                      tagCreators={tagCreators}
                      tagQuery={tagQuery}
                      onTagQuery={setTagQuery}
                      fanTranslation={fanTranslation}
                      textSize={textSize}
                      ofVault={ofVault}
                      vaultReload={vaultReload}
                      creatorId={threadCreator ?? ""}
                      fanKey={selected?.fanKey ?? null}
                      onReadVault={() => void loadOfVault()}
                      onVault={attachVault}
                      onTag={(handle) => { const name = handle.replace(/^@/, "").trim(); setTagHandle(name || null); insertAtCursor(mentionToken(handle)); setPanel(null); }}
                      onFormat={formatCommand}
                      onSize={setTextSize}
                      onFanTranslation={() => setFanTranslation((value) => !value)}
                      onEmoji={insertAtCursor}
                      onClose={() => setPanel(null)}
                      reading={vaultReading}
                      thumbPage={thumbPage}
                      onVaultMore={() => void loadOfVault(vaultPage.current.listId, vaultPage.current.offset)}
                      onOpenFolder={(listId) => void loadOfVault(listId ?? "all", 0)}
                    />
                  </div>
                </div>
              ) : panel === "etiqueta" ? (
                <div className="absolute inset-x-2 bottom-full z-20 mb-1 flex max-h-[min(60vh,32rem)] flex-col overflow-hidden rounded-2xl border border-[#e6e8ee] bg-white shadow-xl">
                  <ComposerPanelBody
                    panel={panel}
                    vaultItems={vaultItems}
                    tagCreators={tagCreators}
                    tagQuery={tagQuery}
                    onTagQuery={setTagQuery}
                    fanTranslation={fanTranslation}
                    textSize={textSize}
                    ofVault={ofVault}
                    vaultReload={vaultReload}
                    creatorId={threadCreator ?? ""}
                    fanKey={selected?.fanKey ?? null}
                    onReadVault={() => void loadOfVault()}
                    onVault={attachVault}
                    onTag={(handle) => { const name = handle.replace(/^@/, "").trim(); setTagHandle(name || null); insertAtCursor(mentionToken(handle)); setPanel(null); }}
                    onFormat={formatCommand}
                    onSize={setTextSize}
                    onFanTranslation={() => setFanTranslation((value) => !value)}
                    onEmoji={insertAtCursor}
                    onClose={() => setPanel(null)}
                    reading={vaultReading}
                    thumbPage={thumbPage}
                    onVaultMore={() => void loadOfVault(vaultPage.current.listId, vaultPage.current.offset)}
                    onOpenFolder={(listId) => void loadOfVault(listId ?? "all", 0)}
                  />
                </div>
              ) : null}
              {showScripts ? (
                <div role="region" aria-label="Panel Guiones" className="absolute inset-x-2 bottom-full z-20 mb-1 max-h-52 overflow-y-auto rounded-xl border border-[#e6e8ee] bg-white p-2 text-sm shadow-lg">
                  <input aria-label="Buscar guiones" value={libraryQuery} placeholder="Buscar guiones" onChange={(event) => setLibraryQuery(event.target.value)} className="mb-2 h-8 w-full rounded border border-[#e6e8ee] px-2 text-sm" />
                  <a href="/funciones?tab=guiones" className="mb-2 block text-xs text-[#2456c7]">Biblioteca de guiones</a>
                  {scriptHits.length === 0 ? <p className="text-xs text-[#6d7585]">Sin datos</p> : scriptHits.map((hit) => (
                    <button key={hit.id} type="button" className="block w-full rounded px-2 py-1 text-left hover:bg-[#f4f7ff]" onClick={() => {
                      replaceDraft(hit.text);
                      if (hit.priceCents != null) {
                        setDraftPrice(hit.priceCents);
                        setPriceLabel(`$${(hit.priceCents / 100).toFixed(2)}`);
                      }
                      setPanel(null);
                    }}>
                      {hit.title} · /{hit.keyword}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex items-start gap-2">
                <div className="grid shrink-0 gap-0" style={{ gridTemplateColumns: "repeat(14, 32px)" }}>
                  {QUICK_EMOJIS.map((emoji) => (
                    <button key={emoji} type="button" className="grid h-8 w-8 place-items-center text-[20px] leading-none" onClick={() => insertAtCursor(emoji)}>{emoji}</button>
                  ))}
                  <button type="button" aria-label="Más emojis" title="Más emojis" className="grid h-8 w-8 place-items-center text-xs text-[#2456c7]" onClick={() => toggle("emojis")}>+</button>
                </div>
                <div className="ml-auto flex shrink-0 gap-1">
                  <button type="button" aria-label="Guiones" title="Guiones" className="flex h-9 items-center gap-1 rounded-lg border border-[#e6e8ee] px-2 text-xs" onClick={() => toggle("guiones")}><ScrollText className="h-4 w-4" />Guiones</button>
                </div>
              </div>
              <div className="my-2 border-t border-[#e6e8ee]" />
              {priceLabel ? <p className="mb-1 text-xs font-medium text-[#8a5a12]">Precio {priceLabel}</p> : null}
              {tagHandle ? <p className="mb-1 text-xs font-medium text-[#2456c7]">Etiqueta @{tagHandle}</p> : null}
              {attachments.some((file) => file.kind === "vault") ? (
                <div className="mb-2 grid gap-2 rounded-xl bg-[#eef6ff] p-2 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-medium text-[#1c2333]">Vista previa gratis</p>
                    <div className="flex gap-2 overflow-x-auto">
                      {attachments.filter((file) => file.kind === "vault" && file.free !== false).map((file) => (
                        <VaultOfferThumb
                          key={file.id}
                          creatorId={selected?.creatorId ?? ""}
                          mediaId={file.id.replace(/^vault-/, "")}
                          name={file.name}
                          free
                          seconds={file.seconds ?? null}
                          dateLabel={file.dateLabel ?? null}
                          offerLabel={file.offerLabel ?? null}
                          onToggle={() => toggleVaultOffer(file.id)}
                          onRemove={() => removeAttachment(file.id)}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <p className="text-xs font-medium text-[#1c2333]">Precio</p>
                      <button type="button" className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-[#2456c7]" onClick={() => { offerPriceId.current = null; setPanel(null); setDialog("precio"); }}>
                        {draftPrice != null && draftPrice > 0 ? `$${(draftPrice / 100).toFixed(2)}` : "Añadir"}
                      </button>
                    </div>
                    <div className="flex gap-2 overflow-x-auto">
                      {attachments.filter((file) => file.kind === "vault" && file.free === false).map((file) => (
                        <VaultOfferThumb
                          key={file.id}
                          creatorId={selected?.creatorId ?? ""}
                          mediaId={file.id.replace(/^vault-/, "")}
                          name={file.name}
                          free={false}
                          seconds={file.seconds ?? null}
                          dateLabel={file.dateLabel ?? null}
                          offerLabel={file.offerLabel ?? null}
                          onToggle={() => toggleVaultOffer(file.id)}
                          onRemove={() => removeAttachment(file.id)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              {attachments.some((file) => file.kind !== "vault") ? (
                <div className="mb-1 flex gap-2 overflow-x-auto">
                  {attachments.filter((file) => file.kind !== "vault").map((file) => (
                    <figure key={file.id} className="relative shrink-0">
                      {file.kind === "video" && file.url ? <SfwMedia><video src={file.url} className="h-16 w-16 rounded object-cover" /></SfwMedia> : null}
                      {file.kind === "image" && file.url ? <SfwMedia><img src={file.url} alt={file.name} className="h-16 w-16 rounded object-cover" /></SfwMedia> : null}
                      {!file.url ? <span className="grid h-16 w-16 place-items-center rounded bg-[#f3f4f6] px-1 text-center text-[10px] leading-tight">{file.name}</span> : null}
                      <figcaption className="max-w-16 truncate text-[10px] text-[#8a5a12]">Pendiente</figcaption>
                      <button type="button" aria-label={`Quitar ${file.name}`} className="mt-0.5 text-[10px] text-[#2456c7]" onClick={() => removeAttachment(file.id)}>Quitar</button>
                    </figure>
                  ))}
                </div>
              ) : null}
              <div className="relative">
                {draft === "" ? <span className="pointer-events-none absolute left-3 top-2 text-sm text-[#9aa1b1]">Pulsa / + palabra para buscar guiones</span> : null}
                <div
                  ref={draftBox}
                  role="textbox"
                  aria-multiline="true"
                  aria-label="Mensaje"
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(event) => setDraft(draftPlain(event.currentTarget))}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
                    if (!event.shiftKey && !composing) event.preventDefault();
                    commitSend(event.key, event.shiftKey, composing);
                  }}
                  onBlur={rememberSelection}
                  onKeyUp={rememberSelection}
                  onMouseUp={rememberSelection}
                  className={`min-h-12 w-full rounded-xl border border-[#e6e8ee] px-3 py-2 outline-none ${textSize === "sm" ? "text-xs" : textSize === "lg" ? "text-base" : "text-sm"}`}
                />
              </div>
              <input
                ref={fileBox}
                type="file"
                accept="image/*,video/*"
                multiple
                aria-label="Archivos"
                className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
                onChange={(event) => {
                  addFiles([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
              />
              <div role="toolbar" aria-label="Herramientas del mensaje" className="relative z-50 mt-2 flex items-center gap-1">
                <ToolButton label="Add media" title="Add media · Añadir archivo" onClick={() => fileBox.current?.click()}><ImagePlus className="h-6 w-6" /></ToolButton>
                <ToolButton label="GIF" title="GIF" active={panel === "gif"} onClick={() => toggle("gif")}><span className="text-[13px] font-bold leading-none">GIF</span></ToolButton>
                <ToolButton label="Add from media vault" title="Add from media vault · Añadir del vault" active={panel === "vault"} onClick={() => { if (panel === "vault") setPanel(null); else void loadOfVault(); }}><FolderOpen className="h-6 w-6" /></ToolButton>
                <ToolButton label="Schedule your message" title="Schedule your message · Programar tu mensaje" active={dialog === "programar"} onClick={() => { setPanel(null); setDialog((current) => current === "programar" ? null : "programar"); }}><Clock className="h-6 w-6" /></ToolButton>
                <ToolButton label="Price" title="Price · Precio" active={dialog === "precio"} onClick={() => { setPanel(null); setDialog((current) => current === "precio" ? null : "precio"); }}><DollarSign className="h-6 w-6" /></ToolButton>
                <ToolButton label="Tag other creator" title="Tag other creator · Etiquetar otra creadora" active={panel === "etiqueta"} onClick={() => toggle("etiqueta")}><AtSign className="h-6 w-6" /></ToolButton>
                <ToolButton label="Format text" title="Format text · Formato de texto" active={panel === "formato"} onClick={() => toggle("formato")}><Type className="h-6 w-6" /></ToolButton>
                <ToolButton label="Translation" title="Translation · Traducción" active={panel === "traduccion"} onClick={() => toggle("traduccion")}><Languages className="h-6 w-6" /></ToolButton>
                <button
                  type="button"
                  disabled={sendBlockedReason != null}
                  title={sendBlockedReason ?? "Enviar"}
                  aria-label="Enviar"
                  onClick={() => commitSend("Enter", false, false)}
                  className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#3b6cff] text-white disabled:opacity-60"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
              {composerError ? <p className="mt-2 text-xs font-medium text-[#b42318]">{composerError}</p> : null}
            </form>
        </div>
      </section>
      {galleryOpen && selected ? <ChatGalleryPanel messages={messages} onClose={() => setGalleryOpen(false)} onJump={(key) => { setGalleryOpen(false); jumpToMessage(key); }} /> : null}
      {insightsOpen ? (
        <div className="fixed inset-0 z-50">
          <button type="button" className="absolute inset-0 bg-black/30" aria-label="Cerrar ficha" onClick={() => setInsightsOpen(false)} />
          <div role="dialog" aria-label="Ficha del fan" className="absolute inset-y-0 right-0 flex w-[min(100%,380px)] min-h-0 flex-col bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-end border-b border-[#e6e8ee] bg-white px-2 py-1">
              <button type="button" aria-label="Cerrar" className="rounded px-2 py-1 text-sm" onClick={() => setInsightsOpen(false)}>X</button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {selected ? (
                <InsightPane thread={selected} cards={fanCards.fans} crmFans={crmFans} messages={messages} profiles={data?.profiles ?? []} notes={data?.notes ?? []} onNotes={saveNote} onProfile={(profile) => { void saveFanProfile({ data: profile }).then(() => refresh()); }} onCopyDraft={(body, price) => { replaceDraft(body); setDraftPrice(price); setPriceLabel(`$${(price / 100).toFixed(2)}`); setInsightsOpen(false); }} onCreatorNote={(body) => { if (!selected.fanKey) return; void saveFanNote({ data: { creatorId: selected.creatorId, fanKey: selected.fanKey, body } }).then(() => refresh()); }} initialTab={insightsTab} />
              ) : (
                <FanInsights
                  name={null}
                  handle={null}
                  spentCents={null}
                  tipsCents={null}
                  status={null}
                  expiresAt={null}
                  renewAuto={null}
                  subPriceCents={null}
                  notes=""
                  notesEditable={false}
                  onNotes={() => undefined}
                  transactions={[]}
                  ppvPrices={[]}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
      {dialog === "precio" ? (
        <MessagePriceDialog
          initial={draftPrice == null ? "" : (draftPrice / 100).toFixed(2)}
          creatorId={selected?.creatorId ?? null}
          threadKey={selected?.threadKey ?? null}
          onCancel={() => {
            offerPriceId.current = null;
            setDialog(null);
          }}
          onSave={(cents) => {
            const only = offerPriceId.current;
            offerPriceId.current = null;
            setDraftPrice(cents);
            setPriceLabel(cents == null ? "Gratis" : `$${(cents / 100).toFixed(2)}`);
            setAttachments((current) => {
              const vault = current.filter((file) => file.kind === "vault");
              const flags = vaultOfferFlagsAfterPrice(vault, cents, only);
              return current.map((file) => {
                if (file.kind !== "vault") return file;
                const free = flags.get(file.id);
                return free == null ? file : { ...file, free };
              });
            });
            setComposerError(null);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === "programar" && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onMouseDown={() => setDialog(null)}>
          <div role="dialog" aria-modal="true" aria-label="Programar tu mensaje" className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
            <h2 className="text-base font-semibold">Programar tu mensaje</h2>
            <input type="datetime-local" aria-label="Fecha programada" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} className="mt-3 h-10 w-full rounded-lg border border-[#e6e8ee] px-2 text-sm" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2 text-sm" onClick={() => setDialog(null)}>Cancelar</button>
              <button type="button" disabled={!draft.trim() || !scheduleAt || !selected} className="rounded-lg bg-[#3b6cff] px-3 py-2 text-sm text-white disabled:opacity-40" onClick={() => savePending(new Date(scheduleAt).toISOString())}>Guardar</button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function InsightPane({
  thread,
  cards,
  crmFans,
  messages,
  profiles,
  notes,
  onNotes,
  onProfile,
  onCopyDraft,
  onCreatorNote,
  initialTab,
}: {
  thread: {
    creatorId: string;
    threadKey?: string | null;
    fanKey: string | null;
    fanName: string | null;
    fanHandle: string | null;
    spentCents: number | null;
    tipsCents: number | null;
    subscribesCents?: number | null;
    postsCents?: number | null;
    messagesCents?: number | null;
    subPriceCents: number | null;
    subExpiresAt: string | null;
    subStartedAt?: string | null;
    subMonths?: number | null;
    renewAuto: boolean | null;
    lists?: string[] | null;
  };
  cards: Parameters<typeof chatFanCardFor>[0];
  crmFans: Array<{ id: string; creatorId: string; handle: string; name: string; notes: string }>;
  messages: Array<{ messageKey: string; body: string; sentAt: string; fromFan: boolean; priceCents: number | null; purchased: boolean | null; mediaCount?: number | null; mediaSeconds?: number | null; mediaPreview?: string | null }>;
  profiles: CreatorChatList["profiles"];
  notes: CreatorChatList["notes"];
  onNotes: (fanId: string, notes: string) => void;
  onProfile: (profile: CreatorChatList["profiles"][number]) => void;
  onCopyDraft: (body: string, priceCents: number) => void;
  onCreatorNote: (body: string) => void;
  initialTab?: "Insights" | "Ventas" | "Notas";
}) {
  const card = chatFanCardFor(cards, thread.creatorId, thread.fanKey);
  const [stored, setStored] = useState<Awaited<ReturnType<typeof readFanPurchases>> | null>(null);
  const threadKey = thread.threadKey ?? thread.fanKey;
  useEffect(() => {
    setStored(null);
    if (!threadKey) return;
    let stop = false;
    // Lectura de la base local. No llama a OnlyFans.
    void readFanPurchases({ data: { creatorId: thread.creatorId, threadKey } })
      .then((value) => { if (!stop) setStored(value); })
      .catch(() => { if (!stop) setStored(null); });
    return () => { stop = true; };
  }, [thread.creatorId, threadKey, messages.length]);
  const allPpvs = mergePpvSources(messages, stored?.ppvs);
  const tipSum = card && card.tips.length > 0 ? card.tips.reduce((sum, tip) => sum + tip.amountCents, 0) : null;
  const crm = crmFans.find((fan) => {
    if (fan.creatorId !== thread.creatorId) return false;
    if (thread.fanHandle && fan.handle.replace(/^@/, "") === thread.fanHandle.replace(/^@/, "")) return true;
    return thread.fanName != null && fan.name === thread.fanName;
  });
  return (
    <FanInsights
      initialTab={initialTab}
      name={thread.fanName}
      handle={thread.fanHandle}
      spentCents={thread.spentCents ?? card?.spentCents ?? null}
      tipsCents={thread.tipsCents ?? tipSum}
      status={card?.status ?? null}
      expiresAt={thread.subExpiresAt ?? card?.expiresAt ?? null}
      subscribedAt={card?.subscribedAt ?? thread.subStartedAt ?? null}
      subMonths={thread.subMonths ?? null}
      rank={stored?.rank ?? null}
      chargebacks={stored?.chargebacks ?? null}
      renewAuto={thread.renewAuto ?? card?.renewAuto ?? null}
      subPriceCents={thread.subPriceCents}
      messagesCents={thread.messagesCents ?? null}
      subscribesCents={thread.subscribesCents ?? null}
      postsCents={thread.postsCents ?? null}
      purchases={stored ? stored.points : null}
      notes={crm?.notes ?? ""}
      notesEditable={crm != null}
      onNotes={(value) => {
        if (crm) onNotes(crm.id, value);
      }}
      transactions={fanCardTransactions(card)}
      ppvPrices={messages.flatMap((message) => (
        !message.fromFan && message.purchased === true && message.priceCents != null && message.priceCents > 0 ? [message.priceCents] : []
      ))}
      lists={thread.lists ?? null}
      profile={thread.fanKey ? profiles.find((item) => item.creatorId === thread.creatorId && item.fanKey === thread.fanKey) ?? { creatorId: thread.creatorId, fanKey: thread.fanKey, nickname: null, birthday: null, timezone: null, source: null, salaryCents: null, lastPayDate: null } : null}
      onProfile={onProfile}
      threadMessages={allPpvs}
      onCopyDraft={onCopyDraft}
      creatorNote={thread.fanKey ? (notes.find((item) => item.creatorId === thread.creatorId && item.fanKey === thread.fanKey) ?? null) : null}
      onCreatorNote={onCreatorNote}
    />
  );
}

type ComposerPanel = "guiones" | "vault" | "gif" | "etiqueta" | "formato" | "traduccion" | "emojis" | null;

type PendingFile = { id: string; url: string | null; name: string; kind: "image" | "video" | "vault"; free?: boolean; seconds?: number | null; offerLabel?: string | null; dateLabel?: string | null };

function vaultPieceName(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return !clean || clean === "Sin datos" ? "" : clean;
}

function VaultThumbRow({ creatorId, pieces }: { creatorId: string; pieces: Array<{ id: string; name: string }> }) {
  return (
    <span className="mb-1 flex justify-end gap-1">
      {pieces.map((piece) => (
        <img key={piece.id} alt="" src={vaultMediaSrc(creatorId, piece.id)} className="h-16 w-12 rounded object-cover" />
      ))}
    </span>
  );
}

function VaultOfferThumb({
  creatorId,
  mediaId,
  name,
  free,
  seconds,
  dateLabel,
  offerLabel,
  onToggle,
  onRemove,
}: {
  creatorId: string;
  mediaId: string;
  name: string;
  free: boolean;
  seconds: number | null;
  dateLabel: string | null;
  offerLabel: string | null;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <figure className="relative h-28 w-24 shrink-0 overflow-hidden rounded-xl bg-[#d7dee8]">
      {broken || !creatorId ? (
        <span className="grid h-full w-full place-items-center px-1 text-center text-[10px] text-[#5c6570]">{vaultPieceName(name) || VAULT_THUMB_MISSING}</span>
      ) : (
        <img src={vaultMediaSrc(creatorId, mediaId)} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      )}
      <button
        type="button"
        aria-pressed={!free}
        aria-label={free ? "Gratis. Pulsar para dejarlo de pago" : "De pago. Pulsar para dejarlo gratis"}
        className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${free ? "bg-black/70 text-white" : "bg-[#ff5a7a] text-white"}`}
        onClick={onToggle}
      >
        {free ? "Gratis" : (offerLabel ?? "De pago")}
      </button>
      <button type="button" aria-label={`Quitar ${name}`} className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-[10px] text-white" onClick={onRemove}>×</button>
      {seconds != null ? <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{formatClip(seconds)}</span> : null}
      {dateLabel ? <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">{dateLabel}</span> : null}
    </figure>
  );
}

function formatClip(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function panelLabel(panel: Exclude<ComposerPanel, null>): string {
  switch (panel) {
    case "guiones":
      return "Panel Guiones";
    case "vault":
      return "Panel Add from media vault";
    case "gif":
      return "Panel GIF";
    case "etiqueta":
      return "Panel Tag other creator";
    case "formato":
      return "Panel Format text";
    case "traduccion":
      return "Panel Translation";
    case "emojis":
      return "Panel Emojis";
    default: {
      const neverPanel: never = panel;
      return neverPanel;
    }
  }
}

function ComposerPanelBody({
  panel,
  vaultItems,
  ofVault,
  vaultReload,
  creatorId,
  fanKey,
  onReadVault,
  tagCreators,
  tagQuery,
  onTagQuery,
  fanTranslation,
  textSize,
  onVault,
  onTag,
  onFormat,
  onSize,
  onFanTranslation,
  onEmoji,
  onClose,
  reading = false,
  thumbPage = { listId: "all", offset: 0 },
  onVaultMore,
  onOpenFolder,
}: {
  panel: Exclude<ComposerPanel, "guiones" | null>;
  vaultItems: VaultItem[];
  ofVault: Array<{ id: string; title: string; kind: "foto" | "video" | "audio" | "gif" | null }>;
  vaultReload: number;
  creatorId: string;
  fanKey: string | null;
  onReadVault: () => void;
  tagCreators: Array<{ id: string; name: string; handle: string }>;
  tagQuery: string;
  onTagQuery: (value: string) => void;
  fanTranslation: boolean;
  textSize: "sm" | "base" | "lg";
  onVault: (item: { id: string; title: string; withId?: string | null; withTitle?: string | null; seconds?: number | null; offerLabel?: string | null; dateLabel?: string | null }) => void;
  onTag: (handle: string) => void;
  onFormat: (command: "bold" | "italic" | "foreColor", value?: string) => void;
  onSize: (size: "sm" | "base" | "lg") => void;
  onFanTranslation: () => void;
  onEmoji: (emoji: string) => void;
  onClose?: () => void;
  reading?: boolean;
  thumbPage?: { listId: string; offset: number };
  onVaultMore?: () => void;
  onOpenFolder?: (listId: string | null) => void;
}) {
  const language = useComposerLanguage();
  switch (panel) {
    case "vault": {
      return (
        <div role="region" aria-label="Panel Add from media vault" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {reading ? <p className="px-4 py-2 text-sm text-[#8a96a3]">Leyendo la bóveda de OnlyFans…</p> : null}
          {creatorId && creatorId !== "all" ? (
            <VaultBrowser layout="of" creatorId={creatorId} fanKey={fanKey} reloadToken={vaultReload} thumbPage={thumbPage} pageItems={ofVault} reading={reading} onAttach={onVault} onClose={onClose} onMore={onVaultMore} onOpenFolder={onOpenFolder} />
          ) : <p className="p-4 text-sm text-[#8a96a3]">Sin datos</p>}
        </div>
      );
    }
    case "gif":
      return (
        <div className="space-y-2">
          <input aria-label="Buscar GIF" placeholder="Buscar GIF" className="h-8 w-full rounded border border-[#e6e8ee] px-2 text-sm" />
          <p className="text-xs text-[#6d7585]">Sin datos. Hace falta una clave de API para buscar GIF.</p>
        </div>
      );
    case "etiqueta": {
      const needle = tagQuery.trim().toLowerCase();
      const visible = tagCreators.filter((creator) => !needle || creator.name.toLowerCase().includes(needle) || creator.handle.toLowerCase().includes(needle));
      return (
        <div role="region" aria-label="Panel Tag other creator" className="flex max-h-[min(60vh,32rem)] min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-[#eceff3] px-4 py-3">
            <p className="text-sm font-semibold tracking-wide">ETIQUETA A OTROS CREADORES</p>
            <input aria-label="Buscar creadora" value={tagQuery} placeholder="Buscar" onChange={(event) => onTagQuery(event.target.value)} className="ml-auto h-8 w-28 rounded-full border border-[#e6e8ee] px-3 text-xs" />
          </div>
          <div className="flex gap-2 border-b border-[#eceff3] px-4 py-3">
            <span className="rounded-full bg-[#d7ebff] px-4 py-1.5 text-sm font-medium text-[#0091ea]">Usuario de etiquetas</span>
            <span className="rounded-full bg-[#f2f3f5] px-4 py-1.5 text-sm text-[#8a96a3]">Formulario de publicación</span>
          </div>
          <div className="border-b border-[#eceff3] px-4 py-4 text-sm">
            <p>Agrega un formulario de publicación o etiqueta a otra persona cuando publiques contenido en el que aparezca.</p>
            <p className="mt-2 text-xs text-[#8a96a3]">El uso de contenido de terceros sin permiso legal constituye una violación de nuestra política de uso aceptable.</p>
          </div>
          <div className="min-h-24 flex-1 overflow-y-auto">
            {/^[A-Za-z0-9._]{2,40}$/.test(tagQuery.replace(/^@/, "").trim()) ? (
              <button type="button" className="block w-full px-4 py-3 text-left text-sm hover:bg-[#f4f7fb]" onClick={() => onTag(tagQuery.replace(/^@/, "").trim())}>
                Etiquetar @{tagQuery.replace(/^@/, "").trim()} en OnlyFans
              </button>
            ) : null}
            {visible.length === 0 ? (
              <div className="grid h-full place-items-center px-6 py-16 text-center text-[#b0b6c0]">
                <p className="text-4xl">@</p>
                <p className="mt-3 text-sm">Aún no hay menciones ni etiquetas</p>
                <p className="mt-1 text-xs">Sin datos</p>
              </div>
            ) : (
              <ul>
                {visible.map((creator) => (
                  <li key={creator.id}>
                    <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#f4f7fb]" onClick={() => onTag(creator.handle)}>
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-[#eef2ff] text-sm">{creator.name.slice(0, 1)}</span>
                      <span>
                        <span className="block text-sm font-medium">{creator.name}</span>
                        <span className="text-xs text-[#8a96a3]">@{creator.handle.replace(/^@/, "")}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-end border-t border-[#eceff3] px-4 py-3">
            <button type="button" className="text-sm font-semibold uppercase tracking-wide text-[#00aff0]" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      );
    }
    case "formato":
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border border-[#e6e8ee] px-2 py-1 text-xs font-semibold" onMouseDown={(event) => event.preventDefault()} onClick={() => onFormat("bold")}>Negrita</button>
            <button type="button" className="rounded border border-[#e6e8ee] px-2 py-1 text-xs italic" onMouseDown={(event) => event.preventDefault()} onClick={() => onFormat("italic")}>Cursiva</button>
            {(["sm", "base", "lg"] as const).map((size) => (
              <button key={size} type="button" aria-pressed={textSize === size} className="rounded border border-[#e6e8ee] px-2 py-1 text-xs" onMouseDown={(event) => event.preventDefault()} onClick={() => onSize(size)}>{size === "sm" ? "Pequeño" : size === "lg" ? "Grande" : "Normal"}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1" aria-label="Colores de texto">
            {TEXT_COLORS.map((color) => (
              <button
                key={color.hex}
                type="button"
                aria-label={`Color ${color.name}`}
                title={color.name}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onFormat("foreColor", color.hex)}
                className="h-6 w-6 rounded-full border border-black/10"
                style={{ background: color.hex }}
              />
            ))}
          </div>
        </div>
      );
    case "traduccion":
      return (
        <div className="space-y-2 text-xs text-[#6d7585]">
          <label className="block">Idioma
            <select aria-label="Idioma" value={language} onChange={(event) => setComposerLanguage(event.target.value === "en" ? "en" : "es")} className="mt-1 block h-8 rounded border border-[#e6e8ee] px-2 text-sm text-[#1c2333]">
              {COMPOSER_LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <p>Sin datos: no hay servicio de traducción.</p>
          <button type="button" className="rounded border border-[#e6e8ee] px-2 py-1" onClick={onFanTranslation}>{fanTranslation ? "Ocultar traducción del fan" : "Mostrar traducción del fan"}</button>
        </div>
      );
    case "emojis":
      return (
        <div className="grid gap-0" style={{ gridTemplateColumns: "repeat(14, 32px)" }}>
          {FULL_EMOJIS.map((emoji) => (
            <button key={`full-${emoji}`} type="button" className="grid h-8 w-8 place-items-center text-[20px] leading-none" onClick={() => onEmoji(emoji)}>{emoji}</button>
          ))}
        </div>
      );
    default: {
      const neverPanel: never = panel;
      return neverPanel;
    }
  }
}

function ToolButton({ label, title, onClick, children, active = false }: { label: string; title: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button type="button" aria-label={label} title={title} aria-pressed={active} onClick={onClick} className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${active ? "bg-[#e7f0ff] text-[#2456c7]" : "text-[#1c2333] hover:bg-[#f3f4f6]"}`}>
      {children}
    </button>
  );
}

function FanFace({ name, url, online }: { name: string; url: string | null; online: boolean | null }) {
  return (
    <span className="relative inline-block h-10 w-10 shrink-0">
      {url ? (
        <SfwMedia><img src={url} alt="" className="h-10 w-10 rounded-full object-cover" /></SfwMedia>
      ) : (
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[#eef2ff] text-sm">{name.slice(0, 1)}</span>
      )}
      {showOnlineDot(online) ? <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-[#00c853]" aria-label="En línea" /> : null}
    </span>
  );
}

function draftPlain(node: HTMLElement): string {
  return node.innerText.replace(/\u00a0/g, " ").replace(/\n$/, "");
}

function selectionOffsets(root: HTMLElement): { start: number; end: number } {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
    const length = draftPlain(root).length;
    return { start: length, end: length };
  }
  const range = selection.getRangeAt(0);
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
}

function pendingCaption(item: { scheduledAt: string | null; authorName: string | null; status: "pending" | "error" | "sending"; stale?: boolean; errorReason: string | null }): string {
  if (item.status === "sending" && item.stale) return "Hay que resolver";
  if (item.status === "sending") return "Enviando…";
  if (item.status === "error" && item.errorReason === "no enviado") return "no enviado";
  if (item.status === "error") return `No se envió: ${item.errorReason ?? "No se envió"}`;
  if (item.scheduledAt) return `Pendiente · programado ${item.scheduledAt.slice(0, 16).replace("T", " ")} · ${item.authorName ?? "Sin datos"} · no enviado`;
  if (item.errorReason === "Pendiente de confirmar") return "Pendiente de confirmar";
  return "Pendiente · no enviado";
}

function chatPhase(data: CreatorChatList | null, creatorId: string | null, running: boolean): ChatSyncInput {
  if (!data) return { hasSession: true, loginInProgress: false, status: null, reason: null, running: false };
  const accounts = data.accounts.filter((row) => creatorId == null || row.creatorId === creatorId);
  const metas = data.meta.filter((row) => creatorId == null || row.creatorId === creatorId);
  const account = accounts[0];
  const meta = metas.find((row) => row.status === "error") ?? metas.find((row) => row.status === "ok") ?? metas[0];
  const hasSession = accounts.some((row) => row.hasStorageState && row.status === "active");
  const loginInProgress = accounts.some((row) => row.loginInProgress);
  if (accounts.length > 1 && metas.some((row) => row.status === "ok")) {
    return { hasSession: true, loginInProgress: false, status: "ok", reason: null, running };
  }
  return {
    hasSession: accounts.length === 1 || creatorId != null
      ? Boolean(account?.hasStorageState && account?.status === "active")
      : hasSession,
    loginInProgress,
    status: meta?.status ?? null,
    reason: meta?.reason ?? null,
    running,
  };
}

function syncPhaseLabel(phase: ChatSyncInput): string {
  return chatSyncLabel(phase);
}

function syncAge(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 1) return "Última sincronización: hace menos de 1 min";
  return `Última sincronización: hace ${mins} min`;
}
