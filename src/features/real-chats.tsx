import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AtSign, Clock, DollarSign, FolderOpen, ImagePlus, Languages, Lock, ScrollText, Send, Type } from "lucide-react";
import { chatSendAccess, discardChatOutbound, listCreatorChats, loadMoreChats, loadOlderMessages, readChatVault, recordChatOutbound, reviewChatOutbound, runFanChatMenu, saveFanNote, saveFanProfile, syncCreatorChats, type CreatorChatList } from "@/lib/of-sessions";
import { useCrm, type VaultItem } from "@/lib/crm";
import { sessionErrorText } from "@/lib/use-creator-sessions";
import { useChatFanCards } from "@/lib/use-chat-fan-cards";
import { chatFanCardFor, fanCardTransactions } from "@/lib/chat-fan-cards";
import { FanInsights } from "@/features/fan-insights";
import { MessagePriceDialog } from "@/features/message-price-dialog";
import { FULL_EMOJIS, QUICK_EMOJIS, TEXT_COLORS, authorLabel, matchScripts, mentionToken, paymentLabel, slashQuery, wrapSelection } from "@/lib/composer-tools";
import { pendingForThread } from "@/lib/pending-thread";
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
import { ChatMediaPlayer } from "@/features/chat-media-player";
import { vaultMediaSrc } from "@/lib/chat-media";
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

function threadMark(creatorId: string, threadKey: string): string {
  return `${creatorId}:${threadKey}`;
}

function ThreadMessage({ message }: { message: {
  creatorId: string;
  threadKey: string;
  messageKey: string;
  fromFan: boolean;
  body: string;
  authorName: string | null;
  automatic: boolean | null;
  mediaCount: number | null;
  media: Array<{ kind: "foto" | "video" | "audio" | null; locked?: boolean | null }> | null;
  priceCents: number | null;
  purchased: boolean | null;
} }) {
  const slides = message.media ?? [];
  const hasMedia = (message.mediaCount ?? 0) > 0 || slides.length > 0;
  const messageLocked = message.purchased === true
    ? false
    : message.priceCents != null && message.priceCents > 0 && message.purchased === false;
  const slideLocked = (slide: { locked?: boolean | null }) => message.purchased === true ? false : messageLocked || slide.locked === true;
  const openSlides = slides.length === 0
    ? (hasMedia && !messageLocked ? [{ kind: "video" as const, index: 0 }] : [])
    : slides.flatMap((slide, index) => (slideLocked(slide) ? [] : [{ kind: slide.kind, index }]));
  const lockedCount = slides.length === 0
    ? (hasMedia && messageLocked ? 1 : 0)
    : slides.filter((slide) => slideLocked(slide)).length;
  const who = message.fromFan ? "" : message.authorName ? authorLabel(message.authorName, false) : authorLabel(null, message.automatic);
  const pay = paymentLabel(message);
  return (
    <li className={message.fromFan ? "" : "text-right"}>
      {(openSlides.length > 0 || message.body) ? (
      <div className={`inline-block max-w-[70%] rounded-2xl px-3 py-2 text-left text-sm ${message.fromFan ? "bg-[#f4f6fb]" : "bg-[#e7f0ff]"}`}>
        {openSlides.map((slide) => (
          <ChatMediaPlayer key={`${message.messageKey}-${slide.index}`} creatorId={message.creatorId} threadKey={message.threadKey} messageKey={message.messageKey} index={slide.index} kind={slide.kind} />
        ))}
        {message.body ? <p>{message.body}</p> : null}
      </div>
      ) : null}
      {lockedCount > 0 ? (
        <p className={`mt-1 flex items-center gap-1 text-[#8a96a3] ${message.fromFan ? "" : "justify-end"}`} aria-label="Medios bloqueados">
          {Array.from({ length: lockedCount }, (_, index) => <Lock key={index} className="h-3.5 w-3.5" aria-hidden />)}
        </p>
      ) : null}
      {who || pay ? <p className="mt-1 text-[10px] text-[#6d7585]">{[who, pay].filter(Boolean).join(" · ")}</p> : null}
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
      <div className="inline-block max-w-[70%] rounded-2xl bg-[#e7f0ff] px-3 py-2 text-left text-sm">
        {job.vault.length > 0 ? <p className="text-[10px] text-[#6d7585]">{job.vault.map((item) => item.name).join(", ")}</p> : null}
        {job.body ? <p>{job.body}</p> : null}
      </div>
      {job.priceLabel ? <p className="mt-1 text-[10px] text-[#6d7585]">Precio {job.priceLabel}</p> : null}
      {caption ? <p className="mt-1 text-[10px] text-[#8a5a12]">{caption}</p> : null}
      {job.state === "error" ? (
        <p className="mt-1 flex justify-end gap-2 text-[10px]">
          <button type="button" className="text-[#2456c7]" onClick={onRetry}>Reintentar</button>
          <button type="button" className="text-[#2456c7]" onClick={onDiscard}>Descartar</button>
          <button type="button" className="text-[#2456c7]" onClick={onRestore}>Recuperar</button>
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
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [filter, setFilter] = useState<"todos" | "propinas" | "online">("todos");
  const [insightsOpen, setInsightsOpen] = useState(false);
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
  const [discountPercent, setDiscountPercent] = useState("10");
  const [reportText, setReportText] = useState("");
  const [draft, setDraft] = useState("");
  const [draftPrice, setDraftPrice] = useState<number | null>(null);
  const [priceLabel, setPriceLabel] = useState<string | null>(null);
  const [sendCreators, setSendCreators] = useState<string[]>([]);
  const jobList = useSyncExternalStore(chatSendSession.subscribe, chatSendSession.getJobs, chatSendSession.getJobs);
  const [pendingOut, setPendingOut] = useState<Array<{ id: string; creatorId: string; threadKey: string; body: string; scheduledAt: string | null; authorName: string | null; authorId: string | null; priceCents: number | null; vault: Array<{ id: string; name: string }>; status: "pending" | "error"; errorReason: string | null }>>([]);
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
  const listLock = useRef(false);
  const pendingRef = useRef(pendingOut);
  const threadBox = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);
  const seenThread = useRef<string | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [ofVault, setOfVault] = useState<Array<{ id: string; title: string; kind: "foto" | "video" | "audio" | null }>>([]);
  const [vaultReload, setVaultReload] = useState(0);
  const [vaultReading, setVaultReading] = useState(false);
  const vaultPage = useRef({ listId: "all", offset: 0, busy: false });
  const offerPriceId = useRef<string | null>(null);

  async function refresh() {
    try {
      const list = await listCreatorChats();
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
          errorReason: item.errorReason,
        }] : []
      ));
      pendingRef.current = nextPending;
      setPendingOut(nextPending);
      setError(null);
    } catch (err) {
      setError(sessionErrorText(err));
    }
  }

  useEffect(() => {
    void refresh();
    void chatSendAccess().then((access) => setSendCreators(access.creatorIds)).catch(() => setSendCreators([]));
    setMarks(readChatMarks());
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, []);

  const threads = (data?.threads ?? []).filter(
    (thread) => creatorId === "all" || thread.creatorId === creatorId,
  );
  const knowsOnline = threads.some((thread) => thread.online != null);
  const ordered = [...threads]
    .filter((thread) => filter !== "propinas" || (thread.tipsCents != null && thread.tipsCents > 0))
    .filter((thread) => filter !== "online" || thread.online === true)
    .sort((left, right) => (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? ""));
  const selected =
    ordered.find((thread) => `${thread.creatorId}:${thread.threadKey}` === selectedKey)
    ?? ordered.find((thread) => !marks.hidden.includes(threadMark(thread.creatorId, thread.threadKey)))
    ?? ordered[0]
    ?? null;
  const visible = ordered.filter((thread) => {
    const id = threadMark(thread.creatorId, thread.threadKey);
    return showHidden || !marks.hidden.includes(id) || (selected != null && id === threadMark(selected.creatorId, selected.threadKey));
  });
  const fanCards = useChatFanCards(visible);
  const messages = (data?.messages ?? [])
    .filter((message) => message.creatorId === selected?.creatorId && message.threadKey === selected?.threadKey)
    .sort((left, right) => left.sentAt.localeCompare(right.sentAt));
  const meta = data?.meta.find((item) => item.creatorId === selected?.creatorId);
  const running = selected ? data?.runningCreatorIds.includes(selected.creatorId) : false;
  const canForce = teamAccess?.role === "owner" && selected != null;
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
  useLayoutEffect(() => {
    const node = threadBox.current;
    if (!node) return;
    if (seenThread.current !== openThread) {
      seenThread.current = openThread;
      stickToBottom.current = true;
    }
    if (!stickToBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, [threadTail, openThread]);
  const creatorName = creatorId === "all"
    ? "Todas las cuentas"
    : creators.find((creator) => creator.id === creatorId)?.name ?? "Cuenta";
  const unread = threads.reduce((sum, thread) => sum + (marks.muted.includes(threadMark(thread.creatorId, thread.threadKey)) ? 0 : thread.unread), 0);
  const slash = slashQuery(draft);
  const scriptHits = matchScripts(scripts, slash != null ? slash : libraryQuery);
  const showScripts = panel === "guiones" || slash != null;
  const realSend = selected != null && sendCreators.includes(selected.creatorId);
  const vaultItems = vault.filter((item) => item.creatorId === selected?.creatorId);
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
    if (!selected && key === "Enter" && !shiftKey && !composing) return;
    const localFiles = attachments.filter((file) => file.kind !== "vault");
    if (key === "Enter" && !shiftKey && !composing && localFiles.length > 0) {
      setError("Los archivos locales siguen pendientes. El vault de OnlyFans sí se adjunta.");
      return;
    }
    const vault = attachments.filter((file) => file.kind === "vault").map((file) => ({
      id: file.id.replace(/^vault-/, ""),
      name: file.name,
      free: file.free !== false,
    }));
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
      setError(decision.reason);
      return;
    }
    if (decision.action === "queued") clearComposer();
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

  function retrySend(clientId: string) {
    const local = chatSendSession.getJobs().find((job) => job.clientId === clientId);
    if (local) {
      chatSendSession.retry(clientId);
      return;
    }
    const item = pendingRef.current.find((row) => row.id === clientId && row.status === "error" && row.authorId === user?.id);
    if (!item) return;
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
    if (vaultPage.current.busy) return;
    vaultPage.current = { listId, offset, busy: true };
    if (offset === 0) setVaultReading(true);
    try {
      const result = await readChatVault({ data: { creatorId: selected.creatorId, threadKey: selected.threadKey, listId, offset } });
      setOfVault(result.items);
      setVaultReload((value) => value + 1);
      vaultPage.current = { listId, offset: offset + 40, busy: false };
      if (offset === 0 && result.items.length === 0) setError(result.reason ?? "La bóveda de OnlyFans ha llegado vacía.");
    } catch (err) {
      vaultPage.current = { listId, offset, busy: false };
      if (offset === 0) setOfVault([]);
      setError(sessionErrorText(err));
    } finally {
      setVaultReading(false);
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

  function attachVault(item: { id: string; title: string; withId?: string | null; withTitle?: string | null; seconds?: number | null; offerLabel?: string | null; dateLabel?: string | null }) {
    const pieces = [{ id: item.id, title: item.title, seconds: item.seconds ?? null, offerLabel: item.offerLabel ?? null, dateLabel: item.dateLabel ?? null }];
    if (item.withId && item.withId !== item.id) pieces.push({ id: item.withId, title: item.withTitle || "Vídeo de pago", seconds: null, offerLabel: null, dateLabel: null });
    const free = !(draftPrice != null && draftPrice > 0);
    setAttachments((current) => {
      const next = [...current];
      for (const piece of pieces) {
        if (next.some((file) => file.id === `vault-${piece.id}`)) continue;
        next.push({ id: `vault-${piece.id}`, url: null, name: piece.title, kind: "vault" as const, free, seconds: piece.seconds, offerLabel: piece.offerLabel, dateLabel: piece.dateLabel });
      }
      return next;
    });
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

  function fanNickname(creatorId: string, fanKey: string | null): string | null {
    if (!fanKey) return null;
    return (data?.profiles ?? []).find((item) => item.creatorId === creatorId && item.fanKey === fanKey)?.nickname ?? null;
  }

  function fanTitle(thread: { creatorId: string; fanKey: string | null; fanName: string | null; fanHandle: string | null }): string {
    return fanNickname(thread.creatorId, thread.fanKey) || thread.fanName || thread.fanHandle || "Fan";
  }

  function saveMarks(next: { hidden: string[]; muted: string[] }) {
    setMarks(next);
    localStorage.setItem(CHAT_MARKS_KEY, JSON.stringify(next));
  }

  function toggleMark(kind: "hidden" | "muted") {
    if (!selected) return;
    const id = threadMark(selected.creatorId, selected.threadKey);
    const has = marks[kind].includes(id);
    const next = { ...marks, [kind]: has ? marks[kind].filter((item) => item !== id) : [...marks[kind], id] };
    saveMarks(next);
    if (kind === "hidden" && !has) {
      const other = ordered.find((thread) => {
        const mark = threadMark(thread.creatorId, thread.threadKey);
        return mark !== id && !next.hidden.includes(mark);
      });
      if (other) setSelectedKey(`${other.creatorId}:${other.threadKey}`);
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
            {knowsOnline ? (
              <button type="button" onClick={() => setFilter(filter === "online" ? "todos" : "online")} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === "online" ? "bg-[#3b6cff] text-white" : "bg-[#eef2ff] text-[#2456c7]"}`}>Fans en línea</button>
            ) : (
              <span className="rounded-lg bg-[#f3f4f6] px-3 py-1.5 text-xs text-[#6d7585]">Fans en línea: Sin datos</span>
            )}
            <span className="rounded-lg bg-[#e8f8ef] px-3 py-1.5 text-xs text-[#137333]">Notificaciones {threads.length === 0 ? "Sin datos" : unread}</span>
          </div>
          <div className="flex items-center gap-2">
            <select value={creatorId} onChange={(event) => setCreator(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-[#e6e8ee] px-2 text-xs" aria-label="Bandeja">
              <option value="all">Todas las bandejas</option>
              {creators.map((creator) => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
            </select>
            <span className="shrink-0 text-[10px] text-[#6d7585]">Más recientes</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setFilter("todos")} className={`rounded-full px-3 py-1 text-xs ${filter === "todos" ? "bg-[#3b6cff] text-white" : "bg-[#f3f4f6] text-[#6d7585]"}`}>Todos</button>
            <button type="button" onClick={() => setFilter("propinas")} className={`rounded-full px-3 py-1 text-xs ${filter === "propinas" ? "bg-[#3b6cff] text-white" : "bg-[#f3f4f6] text-[#6d7585]"}`}>Con propinas</button>
            {marks.hidden.length > 0 ? (
              <button type="button" onClick={() => setShowHidden((open) => !open)} className={`rounded-full px-3 py-1 text-xs ${showHidden ? "bg-[#3b6cff] text-white" : "bg-[#f3f4f6] text-[#6d7585]"}`}>Ocultos {marks.hidden.length}</button>
            ) : null}
          </div>
        </div>
        {error ? <p className="shrink-0 px-4 text-sm text-[#8a5a12]">{error}</p> : null}
        <div className="min-h-0 flex-1 overflow-y-auto" onScroll={(event) => {
          const node = event.currentTarget;
          if (node.scrollHeight - node.scrollTop - node.clientHeight > 48 || listLock.current) return;
          const creator = creatorId === "all" ? selected?.creatorId : creatorId;
          if (!creator) return;
          listLock.current = true;
          void loadMoreChats({ data: { creatorId: creator } }).then(() => refresh()).catch(() => undefined).finally(() => {
            listLock.current = false;
          });
        }}>
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[#6d7585]">{threads.length === 0 ? emptyChatsLabel(data) : "Sin datos"}</p>
        ) : (
          <ul>
            {visible.map((thread) => (
              <li key={`${thread.creatorId}:${thread.threadKey}`}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(`${thread.creatorId}:${thread.threadKey}`)}
                  className={`flex w-full gap-3 px-3 py-3 text-left ${selected?.threadKey === thread.threadKey && selected.creatorId === thread.creatorId ? "bg-[#f4f7ff]" : ""}`}
                >
                  <span className="flex w-12 shrink-0 flex-col items-center gap-1">
                    {thread.avatarUrl ? (
                      <img src={thread.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-[#eef2ff] text-sm">{fanTitle(thread).slice(0, 1)}</span>
                    )}
                    <span className="text-[10px] font-medium" style={{ color: spendTone(thread.spentCents).color ?? "#6d7585" }}>
                      {spendTone(thread.spentCents).label}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-sm font-medium">{fanTitle(thread)}</span>
                      {creatorId === "all" ? <span className="shrink-0 rounded bg-[#f3f4f6] px-1 text-[10px] text-[#6d7585]">{creators.find((creator) => creator.id === thread.creatorId)?.name ?? "Cuenta"}</span> : null}
                      {thread.unread > 0 && !marks.muted.includes(threadMark(thread.creatorId, thread.threadKey)) ? <span className="rounded bg-[#e7f0ff] px-1 text-[10px] font-semibold text-[#2456c7]">NEW</span> : null}
                      {thread.online === false ? <span className="rounded bg-[#f3f4f6] px-1 text-[10px] text-[#6d7585]">OFF</span> : null}
                    </span>
                    <span className="block truncate text-xs text-[#6d7585]">{thread.fanHandle ? `@${thread.fanHandle.replace(/^@/, "")}` : "Sin datos"}</span>
                    <span className="mt-1 flex items-baseline justify-between gap-2 text-xs text-[#6d7585]">
                      <span className="truncate">{thread.excerpt ?? "Sin datos"}</span>
                      <span className="shrink-0">{thread.lastMessageAt ? madridClock(thread.lastMessageAt) : "Sin datos"}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        </div>
      </section>
      <section className="hidden h-full min-h-0 min-w-0 flex-1 md:flex">
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e6e8ee] px-4 py-3">
              <div className="relative min-w-0">
                <button type="button" className="truncate text-left font-medium" onClick={() => { setFanMenu((open) => !open); setRenaming(false); }} aria-expanded={fanMenu} aria-label="Opciones del fan">
                  {selected ? fanTitle(selected) : "Sin sincronizar"}
                </button>
                {selected && creatorId === "all" ? <p className="truncate text-xs text-[#6d7585]">{creators.find((creator) => creator.id === selected.creatorId)?.name ?? "Cuenta"}</p> : null}
                {fanMenu && selected ? (
                  <>
                    <button type="button" aria-label="Cerrar opciones del fan" className="fixed inset-0 z-20 cursor-default" onClick={() => { setFanMenu(false); setRenaming(false); }} />
                    <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-[#e6e8ee] bg-white py-1 text-sm shadow-lg">
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
                          <button type="button" className="block w-full px-4 py-3 text-left text-[#2456c7] hover:bg-[#f4f7ff]" onClick={() => toggleMark("muted")}>{marks.muted.includes(threadMark(selected.creatorId, selected.threadKey)) ? "Activar avisos" : "Silenciar avisos"}</button>
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
              <div className="flex items-center gap-2">
                <button type="button" className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs" onClick={() => void refresh()}>Recargar</button>
                <button type="button" className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs" onClick={() => setInsightsOpen(true)}>Ficha del fan</button>
                <button type="button" className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs" onClick={() => { setFanMenu((open) => !open); setRenaming(false); }} aria-label="Menú" aria-expanded={fanMenu}>Menú</button>
              </div>
            </header>
            {menu && selected ? (
              <div className="shrink-0 border-b border-[#e6e8ee] px-4 py-2 text-xs text-[#6d7585]">
                {running ? "En curso" : meta?.status === "error" ? `Error · ${shortReason(meta.reason)}` : meta?.status === "ok" ? "OK" : "Sin sincronizar"}
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
            <ol ref={threadBox} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" onScroll={(event) => {
              const node = event.currentTarget;
              stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
              if (node.scrollTop > 24 || !selected || olderLock.current) return;
              olderLock.current = true;
              void loadOlderMessages({ data: { creatorId: selected.creatorId, threadKey: selected.threadKey } }).then(() => refresh()).catch(() => undefined).finally(() => {
                olderLock.current = false;
              });
            }}>
              {!selected || (messages.length === 0 && pendingForThread(pendingOut, selected).length === 0 && jobList.every((job) => job.creatorId !== selected.creatorId || job.threadKey !== selected.threadKey)) ? <li className="text-sm text-[#6d7585]">{selected ? "Sin datos" : "Sin sincronizar"}</li> : null}
              {messages.map((message) => (
                <ThreadMessage key={message.messageKey} message={message} />
              ))}
              {pendingBesideLocal(pendingForThread(pendingOut, selected), jobList).map((item) => {
                const recovered = draftFromPending(item);
                const mine = item.authorId != null && item.authorId === user?.id;
                return (
                  <li key={item.id} className="text-right">
                    {item.vault.length > 0 ? <p className="text-[10px] text-[#6d7585]">{item.vault.map((piece) => piece.name).join(", ")}</p> : null}
                    <p className="inline-block max-w-[70%] rounded-2xl border border-dashed border-[#c5cad6] px-3 py-2 text-sm">{item.body}</p>
                    {recovered.priceLabel ? <p className="mt-1 text-[10px] text-[#6d7585]">Precio {recovered.priceLabel}</p> : null}
                    <p className="mt-1 text-[10px] text-[#8a5a12]">{item.status === "error" ? bubbleCaption("error", item.errorReason) : pendingCaption(item)}</p>
                    {item.status === "error" && mine ? (
                      <p className="mt-1 flex justify-end gap-2 text-[10px]">
                        <button type="button" className="text-[#2456c7]" onClick={() => retrySend(item.id)}>Reintentar</button>
                        <button type="button" className="text-[#2456c7]" onClick={() => void discardSend(item.id)}>Descartar</button>
                        <button type="button" className="text-[#2456c7]" onClick={() => restoreDraft(recovered)}>Recuperar</button>
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
            <form className="relative shrink-0 border-t border-[#e6e8ee] p-2" onSubmit={(event) => event.preventDefault()}>
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
                    creatorId={selected?.creatorId ?? creatorId}
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
              {panel === "vault" || panel === "etiqueta" ? (
                <div className={`absolute inset-x-2 bottom-full z-20 mb-1 flex flex-col overflow-hidden rounded-2xl border border-[#e6e8ee] bg-white shadow-xl ${panel === "vault" ? "h-[min(52vh,560px)]" : "max-h-[min(60vh,32rem)]"}`}>
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
                    creatorId={selected?.creatorId ?? creatorId}
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
                    onVaultMore={() => void loadOfVault(vaultPage.current.listId, vaultPage.current.offset)}
                    onOpenFolder={(listId) => void loadOfVault(listId ?? "all", 0)}
                  />
                </div>
              ) : null}
              {showScripts ? (
                <div role="region" aria-label="Panel Guiones" className="absolute inset-x-2 bottom-full z-20 mb-1 max-h-52 overflow-y-auto rounded-xl border border-[#e6e8ee] bg-white p-2 text-sm shadow-lg">
                  <input aria-label="Buscar guiones" value={libraryQuery} placeholder="Buscar guiones" onChange={(event) => setLibraryQuery(event.target.value)} className="mb-2 h-8 w-full rounded border border-[#e6e8ee] px-2 text-sm" />
                  <a href="/guiones" className="mb-2 block text-xs text-[#2456c7]">Biblioteca de guiones</a>
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
                      {file.kind === "video" && file.url ? <video src={file.url} className="h-16 w-16 rounded object-cover" /> : null}
                      {file.kind === "image" && file.url ? <img src={file.url} alt={file.name} className="h-16 w-16 rounded object-cover" /> : null}
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
              <div role="toolbar" aria-label="Herramientas del mensaje" className="mt-2 flex items-center gap-1">
                <ToolButton label="Add media" title="Add media · Añadir archivo" onClick={() => fileBox.current?.click()}><ImagePlus className="h-6 w-6" /></ToolButton>
                <ToolButton label="GIF" title="GIF" active={panel === "gif"} onClick={() => toggle("gif")}><span className="text-[13px] font-bold leading-none">GIF</span></ToolButton>
                <ToolButton label="Add from media vault" title="Add from media vault · Añadir del vault" active={panel === "vault"} onClick={() => { if (panel === "vault") setPanel(null); else void loadOfVault(); }}><FolderOpen className="h-6 w-6" /></ToolButton>
                <ToolButton label="Schedule your message" title="Schedule your message · Programar tu mensaje" active={dialog === "programar"} onClick={() => { setPanel(null); setDialog((current) => current === "programar" ? null : "programar"); }}><Clock className="h-6 w-6" /></ToolButton>
                <ToolButton label="Price" title="Price · Precio" active={dialog === "precio"} onClick={() => { setPanel(null); setDialog((current) => current === "precio" ? null : "precio"); }}><DollarSign className="h-6 w-6" /></ToolButton>
                <ToolButton label="Tag other creator" title="Tag other creator · Etiquetar otra creadora" active={panel === "etiqueta"} onClick={() => toggle("etiqueta")}><AtSign className="h-6 w-6" /></ToolButton>
                <ToolButton label="Format text" title="Format text · Formato de texto" active={panel === "formato"} onClick={() => toggle("formato")}><Type className="h-6 w-6" /></ToolButton>
                <ToolButton label="Translation" title="Translation · Traducción" active={panel === "traduccion"} onClick={() => toggle("traduccion")}><Languages className="h-6 w-6" /></ToolButton>
                <button type="button" disabled={!realSend || !draft.trim()} title={realSend ? "Enviar" : "Envío real desactivado en esta cuenta"} aria-label="Enviar" onClick={() => commitSend("Enter", false, false)} className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#3b6cff] text-white disabled:opacity-60"><Send className="h-5 w-5" /></button>
              </div>
            </form>
        </div>
      </section>
      {insightsOpen ? (
        <div className="fixed inset-0 z-50">
          <button type="button" className="absolute inset-0 bg-black/30" aria-label="Cerrar ficha" onClick={() => setInsightsOpen(false)} />
          <div role="dialog" aria-label="Ficha del fan" className="absolute inset-y-0 right-0 flex w-[min(100%,380px)] min-h-0 flex-col bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-end border-b border-[#e6e8ee] bg-white px-2 py-1">
              <button type="button" aria-label="Cerrar" className="rounded px-2 py-1 text-sm" onClick={() => setInsightsOpen(false)}>X</button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {selected ? (
                <InsightPane thread={selected} cards={fanCards.fans} crmFans={crmFans} messages={messages} profiles={data?.profiles ?? []} notes={data?.notes ?? []} onNotes={saveNote} onProfile={(profile) => { void saveFanProfile({ data: profile }).then(() => refresh()); }} onCopyDraft={(body, price) => { replaceDraft(body); setDraftPrice(price); setPriceLabel(`$${(price / 100).toFixed(2)}`); setInsightsOpen(false); }} onCreatorNote={(body) => { if (!selected.fanKey) return; void saveFanNote({ data: { creatorId: selected.creatorId, fanKey: selected.fanKey, body } }).then(() => refresh()); }} />
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
          messages={messages}
          onCancel={() => {
            offerPriceId.current = null;
            setDialog(null);
          }}
          onSave={(cents) => {
            const only = offerPriceId.current;
            offerPriceId.current = null;
            setDraftPrice(cents);
            setPriceLabel(cents == null ? "Gratis" : `$${(cents / 100).toFixed(2)}`);
            setAttachments((current) => current.map((file) => {
              if (file.kind !== "vault") return file;
              if (cents == null || cents <= 0) return { ...file, free: true };
              if (only) return file.id === only ? { ...file, free: false } : file;
              return { ...file, free: false };
            }));
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
}: {
  thread: {
    creatorId: string;
    fanKey: string | null;
    fanName: string | null;
    fanHandle: string | null;
    spentCents: number | null;
    tipsCents: number | null;
    subPriceCents: number | null;
    subExpiresAt: string | null;
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
}) {
  const card = chatFanCardFor(cards, thread.creatorId, thread.fanKey);
  const tipSum = card && card.tips.length > 0 ? card.tips.reduce((sum, tip) => sum + tip.amountCents, 0) : null;
  const crm = crmFans.find((fan) => {
    if (fan.creatorId !== thread.creatorId) return false;
    if (thread.fanHandle && fan.handle.replace(/^@/, "") === thread.fanHandle.replace(/^@/, "")) return true;
    return thread.fanName != null && fan.name === thread.fanName;
  });
  return (
    <FanInsights
      name={thread.fanName}
      handle={thread.fanHandle}
      spentCents={thread.spentCents ?? card?.spentCents ?? null}
      tipsCents={thread.tipsCents ?? tipSum}
      status={card?.status ?? null}
      expiresAt={thread.subExpiresAt ?? card?.expiresAt ?? null}
      subscribedAt={card?.subscribedAt ?? null}
      renewAuto={thread.renewAuto ?? card?.renewAuto ?? null}
      subPriceCents={thread.subPriceCents}
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
      threadMessages={messages}
      onCopyDraft={onCopyDraft}
      creatorNote={thread.fanKey ? (notes.find((item) => item.creatorId === thread.creatorId && item.fanKey === thread.fanKey) ?? null) : null}
      onCreatorNote={onCreatorNote}
    />
  );
}

type ComposerPanel = "guiones" | "vault" | "gif" | "etiqueta" | "formato" | "traduccion" | "emojis" | null;

type PendingFile = { id: string; url: string | null; name: string; kind: "image" | "video" | "vault"; free?: boolean; seconds?: number | null; offerLabel?: string | null; dateLabel?: string | null };

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
        <span className="grid h-full w-full place-items-center px-1 text-center text-[10px] text-[#5c6570]">{name}</span>
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
  onVaultMore,
  onOpenFolder,
}: {
  panel: Exclude<ComposerPanel, "guiones" | null>;
  vaultItems: VaultItem[];
  ofVault: Array<{ id: string; title: string; kind: "foto" | "video" | "audio" | null }>;
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
  onVaultMore?: () => void;
  onOpenFolder?: (listId: string | null) => void;
}) {
  switch (panel) {
    case "vault": {
      return (
        <div role="region" aria-label="Panel Add from media vault" className="flex h-full min-h-0 flex-col">
          {reading ? <p className="px-4 py-2 text-sm text-[#8a96a3]">Leyendo la bóveda de OnlyFans…</p> : null}
          {creatorId && creatorId !== "all" ? (
            <VaultBrowser layout="of" creatorId={creatorId} fanKey={fanKey} reloadToken={vaultReload} onAttach={onVault} onClose={onClose} onMore={onVaultMore} onOpenFolder={onOpenFolder} />
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
        <div role="region" aria-label="Panel Tag other creator" className="flex min-h-[28rem] flex-col">
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
          <div className="min-h-0 flex-1 overflow-y-auto">
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
            <select aria-label="Idioma" className="mt-1 block h-8 rounded border border-[#e6e8ee] px-2 text-sm text-[#1c2333]">
              <option>Español</option>
              <option>Inglés</option>
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

function pendingCaption(item: { scheduledAt: string | null; authorName: string | null; status: "pending" | "error"; errorReason: string | null }): string {
  if (item.status === "error" && item.errorReason === "no enviado") return "no enviado";
  if (item.status === "error") return `No se envió: ${item.errorReason ?? "No se envió"}`;
  if (item.scheduledAt) return `Pendiente · programado ${item.scheduledAt.slice(0, 16).replace("T", " ")} · ${item.authorName ?? "Sin datos"} · no enviado`;
  if (item.errorReason === "Pendiente de confirmar") return "Pendiente de confirmar";
  return "Pendiente · no enviado";
}

function emptyChatsLabel(data: CreatorChatList | null): string {
  if (data?.meta.some((item) => item.status === "error")) {
    const reason = data.meta.find((item) => item.status === "error")?.reason;
    return reason ? `Error · ${shortReason(reason)}` : "Error";
  }
  if (data?.meta.some((item) => item.status === "ok")) return "Sin conversaciones";
  return "Sin sincronizar";
}

function shortReason(reason: string | null | undefined): string {
  if (!reason) return "error";
  const cut = reason.split(". json:")[0] ?? reason;
  const text = cut.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (/redirigido a login/i.test(text)) return "OnlyFans pide iniciar sesión: pulsa Reconectar";
  return text;
}

function syncAge(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 1) return "Última sincronización: hace menos de 1 min";
  return `Última sincronización: hace ${mins} min`;
}
