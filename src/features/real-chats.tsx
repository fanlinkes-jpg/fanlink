import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AtSign, Clock, DollarSign, FolderOpen, ImagePlus, Languages, ScrollText, Send, Type } from "lucide-react";
import { chatSendAccess, listCreatorChats, loadMoreChats, loadOlderMessages, recordChatOutbound, saveFanNote, saveFanProfile, sendChatMessage, syncCreatorChats, type CreatorChatList, type CreatorReadView } from "@/lib/of-sessions";
import { useCrm, type VaultItem } from "@/lib/crm";
import { sessionErrorText } from "@/lib/use-creator-sessions";
import { useOfReads } from "@/lib/use-of-reads";
import { FanInsights } from "@/features/fan-insights";
import { ChatBubble } from "@/features/chat-bubble";
import { MessagePriceDialog } from "@/features/message-price-dialog";
import { FULL_EMOJIS, QUICK_EMOJIS, TEXT_COLORS, matchScripts, mentionToken, slashQuery, wrapSelection } from "@/lib/composer-tools";

export function RealChatsPage() {
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const setCreator = useCrm((s) => s.setCreator);
  const crmFans = useCrm((s) => s.fans);
  const scripts = useCrm((s) => s.scripts);
  const vault = useCrm((s) => s.vault);
  const saveNote = useCrm((s) => s.saveNote);
  const teamAccess = useCrm((s) => s.teamAccess);
  const reads = useOfReads();
  const [data, setData] = useState<CreatorChatList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [filter, setFilter] = useState<"todos" | "propinas" | "online">("todos");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftPrice, setDraftPrice] = useState<number | null>(null);
  const [priceLabel, setPriceLabel] = useState<string | null>(null);
  const [sendCreators, setSendCreators] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [pendingOut, setPendingOut] = useState<Array<{ id: string; creatorId: string; threadKey: string; body: string; scheduledAt: string | null; authorName: string | null; status: "pending" | "error"; errorReason: string | null }>>([]);
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

  async function refresh() {
    try {
      const list = await listCreatorChats();
      setData(list);
      setPendingOut(list.pending.flatMap((item) => (
        item.threadKey ? [{ id: item.id, creatorId: item.creatorId, threadKey: item.threadKey, body: item.body, scheduledAt: item.scheduledAt, authorName: item.authorName, status: item.status, errorReason: item.errorReason }] : []
      )));
      setError(null);
    } catch (err) {
      setError(sessionErrorText(err));
    }
  }

  useEffect(() => {
    void refresh();
    void chatSendAccess().then((access) => setSendCreators(access.creatorIds)).catch(() => setSendCreators([]));
  }, []);

  const threads = (data?.threads ?? []).filter(
    (thread) => creatorId === "all" || thread.creatorId === creatorId,
  );
  const knowsOnline = threads.some((thread) => thread.online != null);
  const visible = [...threads]
    .filter((thread) => filter !== "propinas" || (thread.tipsCents != null && thread.tipsCents > 0))
    .filter((thread) => filter !== "online" || thread.online === true)
    .sort((left, right) => (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? ""));
  const selected =
    visible.find((thread) => `${thread.creatorId}:${thread.threadKey}` === selectedKey) ?? visible[0] ?? null;
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
  const creatorName = creatorId === "all"
    ? "Todas las cuentas"
    : creators.find((creator) => creator.id === creatorId)?.name ?? "Cuenta";
  const unread = threads.reduce((sum, thread) => sum + thread.unread, 0);
  const scriptHits = matchScripts(scripts, slashQuery(draft) ?? "");
  const showScripts = panel === "guiones" || slashQuery(draft) != null;
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

  async function sendNow() {
    if (!selected || !draft.trim() || !realSend || sending) return;
    if (attachments.length > 0) {
      setError("Los adjuntos siguen pendientes. Este envío es de texto y precio.");
      return;
    }
    const body = draft.trim();
    const price = draftPrice;
    setSending(true);
    try {
      const result = await sendChatMessage({
        data: {
          creatorId: selected.creatorId,
          fanKey: selected.fanKey,
          threadKey: selected.threadKey,
          body,
          priceCents: price,
        },
      });
      if (result.sent) {
        replaceDraft("");
        setDraftPrice(null);
        setPriceLabel(null);
        setError(null);
      }
      await refresh();
      if (!result.sent) setError(result.reason ?? "No se envió");
    } catch (err) {
      setError(sessionErrorText(err));
    } finally {
      setSending(false);
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

  function attachVault(item: VaultItem) {
    setAttachments((current) => current.some((file) => file.id === `vault-${item.id}`) ? current : [
      ...current,
      { id: `vault-${item.id}`, url: null, name: item.title, kind: "vault" as const },
    ]);
    setPanel(null);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const hit = current.find((file) => file.id === id);
      if (hit?.url) URL.revokeObjectURL(hit.url);
      return current.filter((file) => file.id !== id);
    });
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
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-[#eef2ff] text-sm">{(thread.fanName ?? "F").slice(0, 1)}</span>
                    )}
                    <span className={`text-[10px] font-medium ${thread.spentCents == null ? "text-[#6d7585]" : "text-[#137333]"}`}>
                      {thread.spentCents == null ? "Sin datos" : `$${(thread.spentCents / 100).toFixed(2)}`}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-sm font-medium">{thread.fanName ?? "Fan"}</span>
                      {thread.unread > 0 ? <span className="rounded bg-[#e7f0ff] px-1 text-[10px] font-semibold text-[#2456c7]">NEW</span> : null}
                      {thread.online === false ? <span className="rounded bg-[#f3f4f6] px-1 text-[10px] text-[#6d7585]">OFF</span> : null}
                    </span>
                    <span className="block truncate text-xs text-[#6d7585]">{thread.fanHandle ? `@${thread.fanHandle.replace(/^@/, "")}` : "Sin datos"}</span>
                    <span className="mt-1 flex items-baseline justify-between gap-2 text-xs text-[#6d7585]">
                      <span className="truncate">{thread.excerpt ?? "Sin datos"}</span>
                      <span className="shrink-0">{thread.lastMessageAt ? thread.lastMessageAt.slice(11, 16) : "Sin datos"}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        </div>
      </section>
      <section className="hidden h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e6e8ee] px-4 py-3">
              <p className="truncate font-medium">{selected ? (selected.fanName ?? selected.fanHandle ?? "Fan") : "Sin sincronizar"}</p>
              <div className="flex items-center gap-2">
                <button type="button" className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs" onClick={() => void refresh()}>Recargar</button>
                <button type="button" className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs" onClick={() => setInsightsOpen(true)}>Ficha del fan</button>
                <button type="button" className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs" onClick={() => setMenu((open) => !open)} aria-label="Menú">Menú</button>
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
            <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" onScroll={(event) => {
              if (event.currentTarget.scrollTop > 24 || !selected || olderLock.current) return;
              olderLock.current = true;
              void loadOlderMessages({ data: { creatorId: selected.creatorId, threadKey: selected.threadKey } }).then(() => refresh()).catch(() => undefined).finally(() => {
                olderLock.current = false;
              });
            }}>
              {!selected || messages.length === 0 ? <li className="text-sm text-[#6d7585]">{selected ? "Sin datos" : "Sin sincronizar"}</li> : null}
              {pendingOut.filter((item) => item.creatorId === selected?.creatorId && item.threadKey === selected?.threadKey).map((item) => (
                <li key={item.id} className="text-right">
                  <p className="inline-block max-w-[70%] rounded-2xl border border-dashed border-[#c5cad6] px-3 py-2 text-sm">{item.body}</p>
                  <p className="mt-1 text-[10px] text-[#8a5a12]">{pendingCaption(item)}</p>
                </li>
              ))}
              {messages.map((message) => (
                <ChatBubble key={message.messageKey} message={message} />
              ))}
              {messages.some((message) => message.fromFan) && fanTranslation ? <li className="text-[10px] text-[#6d7585]">Traducción: Sin datos</li> : null}
            </ol>
            <form className="relative shrink-0 border-t border-[#e6e8ee] p-2" onSubmit={(event) => event.preventDefault()}>
              {panel && panel !== "guiones" ? (
                <div role="region" aria-label={panelLabel(panel)} className="absolute inset-x-2 bottom-full z-20 mb-1 max-h-52 overflow-y-auto rounded-xl border border-[#e6e8ee] bg-white p-3 text-sm shadow-lg">
                  <ComposerPanelBody
                    panel={panel}
                    vaultItems={vaultItems}
                    tagCreators={tagCreators}
                    fanTranslation={fanTranslation}
                    textSize={textSize}
                    onVault={attachVault}
                    onTag={(handle) => { insertAtCursor(mentionToken(handle)); setPanel(null); }}
                    onFormat={formatCommand}
                    onSize={setTextSize}
                    onFanTranslation={() => setFanTranslation((value) => !value)}
                    onEmoji={insertAtCursor}
                  />
                </div>
              ) : null}
              {showScripts ? (
                <div role="region" aria-label="Panel Guiones" className="absolute inset-x-2 bottom-full z-20 mb-1 max-h-36 overflow-y-auto rounded-xl border border-[#e6e8ee] bg-white p-2 text-sm shadow-lg">
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
              {attachments.length > 0 ? (
                <div className="mb-1 flex gap-2 overflow-x-auto">
                  {attachments.map((file) => (
                    <figure key={file.id} className="relative shrink-0">
                      {file.kind === "video" && file.url ? <video src={file.url} className="h-14 w-14 rounded object-cover" /> : null}
                      {file.kind === "image" && file.url ? <img src={file.url} alt={file.name} className="h-14 w-14 rounded object-cover" /> : null}
                      {file.kind === "vault" || !file.url ? <span className="grid h-14 w-14 place-items-center rounded bg-[#f3f4f6] px-1 text-center text-[10px] leading-tight">{file.name}</span> : null}
                      <figcaption className="max-w-14 truncate text-[10px] text-[#8a5a12]">Pendiente</figcaption>
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
                    if (event.key !== "Enter" || event.shiftKey) return;
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    event.preventDefault();
                    void sendNow();
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
                <ToolButton label="Add from media vault" title="Add from media vault · Añadir del vault" active={panel === "vault"} onClick={() => toggle("vault")}><FolderOpen className="h-6 w-6" /></ToolButton>
                <ToolButton label="Schedule your message" title="Schedule your message · Programar tu mensaje" active={dialog === "programar"} onClick={() => { setPanel(null); setDialog((current) => current === "programar" ? null : "programar"); }}><Clock className="h-6 w-6" /></ToolButton>
                <ToolButton label="Price" title="Price · Precio" active={dialog === "precio"} onClick={() => { setPanel(null); setDialog((current) => current === "precio" ? null : "precio"); }}><DollarSign className="h-6 w-6" /></ToolButton>
                <ToolButton label="Tag other creator" title="Tag other creator · Etiquetar otra creadora" active={panel === "etiqueta"} onClick={() => toggle("etiqueta")}><AtSign className="h-6 w-6" /></ToolButton>
                <ToolButton label="Format text" title="Format text · Formato de texto" active={panel === "formato"} onClick={() => toggle("formato")}><Type className="h-6 w-6" /></ToolButton>
                <ToolButton label="Translation" title="Translation · Traducción" active={panel === "traduccion"} onClick={() => toggle("traduccion")}><Languages className="h-6 w-6" /></ToolButton>
                {realSend ? <span className="ml-auto shrink-0 text-xs font-semibold text-[#137333]">Envío real</span> : null}
                <button type="button" disabled={!realSend || !draft.trim() || sending} title={realSend ? "Envío real" : "Envío real desactivado en esta cuenta"} aria-label="Enviar" onClick={() => void sendNow()} className={`${realSend ? "" : "ml-auto"} grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#3b6cff] text-white disabled:opacity-60`}><Send className="h-5 w-5" /></button>
              </div>
            </form>
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
                <InsightPane thread={selected} reads={reads.byCreator} crmFans={crmFans} messages={messages} profiles={data?.profiles ?? []} notes={data?.notes ?? []} onNotes={saveNote} onProfile={(profile) => { void saveFanProfile({ data: profile }).then(() => refresh()); }} onCopyDraft={(body, price) => { replaceDraft(body); setDraftPrice(price); setPriceLabel(`$${(price / 100).toFixed(2)}`); setInsightsOpen(false); }} onCreatorNote={(body) => { if (!selected.fanKey) return; void saveFanNote({ data: { creatorId: selected.creatorId, fanKey: selected.fanKey, body } }).then(() => refresh()); }} />
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
          onCancel={() => setDialog(null)}
          onSave={(cents) => {
            setDraftPrice(cents);
            setPriceLabel(cents == null ? "Gratis" : `$${(cents / 100).toFixed(2)}`);
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
  reads,
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
  reads: Map<string, CreatorReadView>;
  crmFans: Array<{ id: string; creatorId: string; handle: string; name: string; notes: string }>;
  messages: Array<{ messageKey: string; body: string; sentAt: string; fromFan: boolean; priceCents: number | null; purchased: boolean | null; mediaCount?: number | null; mediaSeconds?: number | null; mediaPreview?: string | null }>;
  profiles: CreatorChatList["profiles"];
  notes: CreatorChatList["notes"];
  onNotes: (fanId: string, notes: string) => void;
  onProfile: (profile: CreatorChatList["profiles"][number]) => void;
  onCopyDraft: (body: string, priceCents: number) => void;
  onCreatorNote: (body: string) => void;
}) {
  const read = reads.get(thread.creatorId);
  const ofFan = read?.fans.find((fan) => fan.fanKey === thread.fanKey) ?? null;
  const crm = crmFans.find((fan) => {
    if (fan.creatorId !== thread.creatorId) return false;
    if (thread.fanHandle && fan.handle.replace(/^@/, "") === thread.fanHandle.replace(/^@/, "")) return true;
    return thread.fanName != null && fan.name === thread.fanName;
  });
  return (
    <FanInsights
      name={thread.fanName}
      handle={thread.fanHandle}
      spentCents={thread.spentCents ?? ofFan?.spentCents ?? null}
      tipsCents={thread.tipsCents}
      status={ofFan?.status ?? null}
      expiresAt={thread.subExpiresAt ?? ofFan?.expiresAt ?? null}
      subscribedAt={ofFan?.subscribedAt ?? null}
      renewAuto={thread.renewAuto ?? ofFan?.renewAuto ?? null}
      subPriceCents={thread.subPriceCents}
      notes={crm?.notes ?? ""}
      notesEditable={crm != null}
      onNotes={(value) => {
        if (crm) onNotes(crm.id, value);
      }}
      transactions={(read?.transactions ?? []).filter((row) => row.fanKey === thread.fanKey).map((row) => ({
        occurredAt: row.occurredAt,
        grossCents: row.grossCents,
        kind: row.kind,
      }))}
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

type PendingFile = { id: string; url: string | null; name: string; kind: "image" | "video" | "vault" };

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
  tagCreators,
  fanTranslation,
  textSize,
  onVault,
  onTag,
  onFormat,
  onSize,
  onFanTranslation,
  onEmoji,
}: {
  panel: Exclude<ComposerPanel, "guiones" | null>;
  vaultItems: VaultItem[];
  tagCreators: Array<{ id: string; name: string; handle: string }>;
  fanTranslation: boolean;
  textSize: "sm" | "base" | "lg";
  onVault: (item: VaultItem) => void;
  onTag: (handle: string) => void;
  onFormat: (command: "bold" | "italic" | "foreColor", value?: string) => void;
  onSize: (size: "sm" | "base" | "lg") => void;
  onFanTranslation: () => void;
  onEmoji: (emoji: string) => void;
}) {
  switch (panel) {
    case "vault":
      return vaultItems.length === 0 ? <p className="text-xs text-[#6d7585]">Sin datos</p> : (
        <ul className="space-y-1">
          {vaultItems.map((item) => (
            <li key={item.id}>
              <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-[#f4f7ff]" onClick={() => onVault(item)}>{item.title}</button>
            </li>
          ))}
        </ul>
      );
    case "gif":
      return (
        <div className="space-y-2">
          <input aria-label="Buscar GIF" placeholder="Buscar GIF" className="h-8 w-full rounded border border-[#e6e8ee] px-2 text-sm" />
          <p className="text-xs text-[#6d7585]">Sin datos. Hace falta una clave de API para buscar GIF.</p>
        </div>
      );
    case "etiqueta":
      return tagCreators.length === 0 ? <p className="text-xs text-[#6d7585]">Sin datos</p> : (
        <ul className="space-y-1">
          {tagCreators.map((creator) => (
            <li key={creator.id}>
              <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-[#f4f7ff]" onClick={() => onTag(creator.handle)}>
                {creator.name} · @{creator.handle.replace(/^@/, "")}
              </button>
            </li>
          ))}
        </ul>
      );
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
  if (item.status === "error") return `Error · ${item.errorReason ?? "No se envió"} · sin reintento`;
  if (item.scheduledAt) return `Pendiente · programado ${item.scheduledAt.slice(0, 16).replace("T", " ")} · ${item.authorName ?? "Sin datos"} · no enviado`;
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
