import { useEffect, useMemo, useRef, useState } from "react"
import { Search, Send, Smile, FileText, Phone, Mail, ExternalLink, MoreHorizontal, UserCircle2, AtSign, Sparkles, ChevronRight, ChevronLeft, Paperclip, Info, Wand2, Archive } from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { useApi, getJSON } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { useAuth } from "@/contexts/AuthContext"
import { type Conversation, type Message, type Template, type Channel, CHANNEL_LABEL, channelIcon, relativeTime, EMOJIS, fillTemplate, suggestTemplates } from "@/lib/messaging"
import { type Lead, type LeadStatus, STATUS_ORDER as LEAD_STATUS_ORDER, STATUS_LABEL as LEAD_STATUS_LABEL } from "@/lib/leads"
import { findConvId, digits, quoteShareMessage } from "@/lib/chat"
import { statusLabel } from "@/components/RowActions"
import { SearchPicker } from "@/components/SearchPicker"
import { useConfirm } from "@/components/ui/confirm"
import { LeadForm } from "@/components/forms/LeadForm"
import { QuoteForm, type QuotePrefill } from "@/components/forms/QuoteForm"
import { fmtMoney, cn } from "@/lib/utils"
import { openPacificPdf } from "@/lib/pdf"
import type { Sale, Quote } from "@/lib/types"

type Client = {
  id: string
  name: string
  emails?: string[]
  phones?: string[]
  addresses?: string[]
  dni?: string
  type?: string
  updated_at?: string
}

type ChannelFilter = "all" | Channel

export default function MensajesPage() {
  // Auto-refresh: la lista de conversaciones y los leads se repiden solos cada 8s
  // (aparecen mensajes/conversaciones nuevos sin recargar la página).
  const convApi = useApi<Conversation[]>("/api/conversations", { pollMs: 8000 })
  const conversations = convApi.data ?? []
  const templates = useApi<Template[]>("/api/templates").data ?? []
  const clients = useApi<Client[]>("/api/clients").data ?? []
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const leads = useApi<Lead[]>("/api/leads", { pollMs: 8000 }).data ?? []
  const quotes = useApi<Quote[]>("/api/quotes").data ?? []
  const leadById = useMemo(() => {
    const m = new Map<string, Lead>()
    for (const l of leads) m.set(l.id, l)
    return m
  }, [leads])

  const [searchParams, setSearchParams] = useSearchParams()
  const convFromUrl = searchParams.get("conv")
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all")
  const [q, setQ] = useState("")
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [onlyPending, setOnlyPending] = useState(false)   // esperan NUESTRA respuesta (última 'in')
  const [onlyWaiting, setOnlyWaiting] = useState(false)   // esperan al cliente (última 'out' hace ≥3d)
  const [showClosed, setShowClosed] = useState(false)
  const [sellerFilter, setSellerFilter] = useState("")   // "" todos · "__none__" sin asignar · nombre
  const [selectedId, setSelectedId] = useState<string | null>(convFromUrl)
  const [showContact, setShowContact] = useState(false)   // móvil: panel de ficha como overlay

  // Vendedor asignado de una conversación = el del lead vinculado.
  const sellerOf = (c: Conversation) => (c.linked_lead_id ? leadById.get(c.linked_lead_id)?.assigned_seller : "") || ""
  const sellers = useMemo(() => [...new Set(leads.map(l => l.assigned_seller).filter(Boolean) as string[])].sort(), [leads])

  // Pendiente = última del cliente (no se resetea al abrir, solo al responder).
  const isPending = (c: Conversation) => c.last_message_direction === "in" && c.status !== "closed"
  const waitCutoff = useMemo(() => new Date(Date.now() - 3 * 86400e3).toISOString(), [])
  const isWaiting = (c: Conversation) => c.last_message_direction === "out" && c.status !== "closed" && (c.last_outbound_at ?? c.last_message_at ?? "") < waitCutoff
  const pendingCount = useMemo(() => conversations.filter(isPending).length, [conversations])
  const waitingCount = useMemo(() => conversations.filter(isWaiting).length, [conversations, waitCutoff])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return conversations.filter(c => {
      if (c.status === "closed" && !showClosed) return false   // cerradas ocultas salvo toggle
      if (channelFilter !== "all" && c.channel !== channelFilter) return false
      if (onlyUnread && (c.unread_count ?? 0) <= 0) return false
      if (onlyPending && !isPending(c)) return false
      if (onlyWaiting && !isWaiting(c)) return false
      if (sellerFilter === "__none__" && sellerOf(c)) return false
      if (sellerFilter && sellerFilter !== "__none__" && sellerOf(c) !== sellerFilter) return false
      if (!needle) return true
      return c.contact_name.toLowerCase().includes(needle)
        || c.contact_id.toLowerCase().includes(needle)
        || (c.last_message_preview ?? "").toLowerCase().includes(needle)
    }).sort((a, b) => {
      // Pendientes (esperan nuestra respuesta) primero; dentro, más nuevo primero.
      const pa = isPending(a) ? 1 : 0, pb = isPending(b) ? 1 : 0
      if (pa !== pb) return pb - pa
      return (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "")
    })
  }, [conversations, channelFilter, q, onlyUnread, onlyPending, onlyWaiting, showClosed, sellerFilter, leadById, waitCutoff])

  // Default-select the first conversation when the list arrives — SOLO en desktop.
  // En móvil queremos ver primero la lista (single-pane); auto-seleccionar saltearía
  // directo al chat. (chequeo puntual al montar/llegar la lista, no reactivo a resize)
  useEffect(() => {
    const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
    if (isDesktop && selectedId == null && filtered.length > 0) setSelectedId(filtered[0].id)
  }, [filtered, selectedId])

  // When the URL changes (someone clicks a lead → /mensajes?conv=…) re-sync the selection
  useEffect(() => {
    if (convFromUrl && convFromUrl !== selectedId) setSelectedId(convFromUrl)
  }, [convFromUrl])

  // Abrir el chat de un contacto desde otra página: /mensajes?client=…&phone=…&email=…
  useEffect(() => {
    if (convFromUrl || !conversations.length) return
    const client = searchParams.get("client"), phone = searchParams.get("phone"), email = searchParams.get("email")
    if (!client && !phone && !email) return
    const id = findConvId(conversations, { name: client ?? undefined, phone: phone ?? undefined, email: email ?? undefined })
    if (id) setSelectedId(id)
  }, [conversations, convFromUrl])

  // When the user picks a row manually, keep the URL in sync so refresh works
  const handleSelect = (id: string) => {
    setSelectedId(id)
    setSearchParams(prev => { prev.set("conv", id); return prev }, { replace: true })
  }

  const selected = conversations.find(c => c.id === selectedId) ?? null

  // Móvil (single-pane): volver del chat a la lista. En desktop el grid muestra los 3 a la vez.
  const clearSelection = () => {
    setSelectedId(null)
    setShowContact(false)
    setSearchParams(prev => { prev.delete("conv"); return prev }, { replace: true })
  }

  // "Ignorar": archiva la conversación (status closed) → desaparece de la lista (no es consulta:
  // banco, proveedores, comex, etc.) y deja de contar como pendiente. Se ve con el toggle "Ignoradas".
  const ignoreConv = async (id: string) => {
    try {
      await fetch(`/api/conversations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "closed" }) })
      if (selectedId === id) clearSelection()
      convApi.refetch()
    } catch { /* ignore */ }
  }

  // En desktop (lg) cada panel es item directo del grid y se muestra siempre (lg:flex).
  // En móvil mostramos UNO solo: lista si no hay conversación, el chat si hay; la ficha
  // (ContactPanel) se abre como overlay con el botón ⓘ del header del chat.
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-0 px-4 lg:px-6 min-h-0 overflow-hidden h-[calc(100svh-5.5rem)] md:h-[calc(100svh-6.5rem)]">
      <ConversationList
        className={cn("lg:flex", selectedId ? "hidden" : "flex")}
        conversations={filtered}
        total={conversations.length}
        selectedId={selectedId}
        onSelect={handleSelect}
        onIgnore={ignoreConv}
        channelFilter={channelFilter}
        setChannelFilter={setChannelFilter}
        q={q}
        setQ={setQ}
        leadById={leadById}
        onlyUnread={onlyUnread}
        setOnlyUnread={setOnlyUnread}
        onlyPending={onlyPending}
        setOnlyPending={setOnlyPending}
        onlyWaiting={onlyWaiting}
        setOnlyWaiting={setOnlyWaiting}
        pendingCount={pendingCount}
        waitingCount={waitingCount}
        showClosed={showClosed}
        setShowClosed={setShowClosed}
        sellerFilter={sellerFilter}
        setSellerFilter={setSellerFilter}
        sellers={sellers}
      />
      <Thread
        className={cn("lg:flex", selectedId && !showContact ? "flex" : "hidden")}
        conversation={selected}
        templates={templates}
        onBack={clearSelection}
        onShowContact={() => setShowContact(true)}
      />
      <ContactPanel
        className={cn("lg:flex", showContact ? "flex" : "hidden")}
        conversation={selected}
        clients={clients}
        sales={sales}
        leads={leads}
        leadById={leadById}
        quotes={quotes}
        onClose={() => setShowContact(false)}
      />
    </div>
  )
}

// -----------------------------------------------------------------------------
// LEFT — conversation list
// -----------------------------------------------------------------------------

function ConversationList({
  conversations, total, selectedId, onSelect, onIgnore, channelFilter, setChannelFilter, q, setQ, leadById,
  onlyUnread, setOnlyUnread, onlyPending, setOnlyPending, onlyWaiting, setOnlyWaiting, pendingCount, waitingCount,
  showClosed, setShowClosed, sellerFilter, setSellerFilter, sellers, className,
}: {
  conversations: Conversation[]
  total: number
  className?: string
  selectedId: string | null
  onSelect: (id: string) => void
  onIgnore: (id: string) => void
  channelFilter: ChannelFilter
  setChannelFilter: (c: ChannelFilter) => void
  q: string
  setQ: (s: string) => void
  leadById: Map<string, Lead>
  onlyUnread: boolean
  setOnlyUnread: (b: boolean) => void
  onlyPending: boolean
  setOnlyPending: (b: boolean) => void
  onlyWaiting: boolean
  setOnlyWaiting: (b: boolean) => void
  pendingCount: number
  waitingCount: number
  showClosed: boolean
  setShowClosed: (b: boolean) => void
  sellerFilter: string
  setSellerFilter: (s: string) => void
  sellers: string[]
}) {
  return (
    <aside className={cn("flex-col border border-border rounded-l-lg bg-card overflow-hidden", className)}>
      <div className="p-3 border-b border-border space-y-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conversación…" className="pl-8 h-8" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant={onlyPending ? "default" : "outline"} size="sm" className="h-7 text-xs px-2" onClick={() => { setOnlyPending(!onlyPending); setOnlyWaiting(false) }}>
            Pendientes{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </Button>
          <Button variant={onlyWaiting ? "default" : "outline"} size="sm" className="h-7 text-xs px-2" onClick={() => { setOnlyWaiting(!onlyWaiting); setOnlyPending(false) }} title="Esperando respuesta del cliente (+3 días)">
            Esperando{waitingCount > 0 ? ` (${waitingCount})` : ""}
          </Button>
          <Button variant={onlyUnread ? "default" : "outline"} size="sm" className="h-7 text-xs px-2" onClick={() => setOnlyUnread(!onlyUnread)}>No leídos</Button>
          <Button variant={showClosed ? "default" : "outline"} size="sm" className="h-7 text-xs px-2" onClick={() => setShowClosed(!showClosed)}>{showClosed ? "Ignoradas" : "Activas"}</Button>
        </div>
        <div className="flex items-center gap-1.5">
          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value as ChannelFilter)} className="h-7 flex-1 rounded-md border border-input bg-transparent px-2 text-xs">
            <option value="all">Todos los canales</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="email">Email</option>
          </select>
          <select value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)} className="h-7 flex-1 rounded-md border border-input bg-transparent px-2 text-xs">
            <option value="">Todos los vendedores</option>
            <option value="__none__">Sin asignar</option>
            {sellers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="text-[11px] text-muted-foreground">{conversations.length} de {total} conversaciones</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-10">Sin conversaciones</div>
        ) : conversations.map((c) => (
          <ConversationRow key={c.id} conv={c} lead={c.linked_lead_id ? leadById.get(c.linked_lead_id) : undefined} selected={c.id === selectedId} onClick={() => onSelect(c.id)} onIgnore={onIgnore} />
        ))}
      </div>
    </aside>
  )
}

function ConversationRow({ conv, lead, selected, onClick, onIgnore }: { conv: Conversation; lead?: Lead; selected: boolean; onClick: () => void; onIgnore: (id: string) => void }) {
  const ChannelIcon = channelIcon(conv.channel) ?? AtSign
  const pending = conv.last_message_direction === "in" && conv.status !== "closed"   // espera nuestra respuesta
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick() } }}
      className={cn("group relative w-full cursor-pointer text-left px-3 py-2.5 border-b border-border transition-colors min-w-0", pending && "border-l-2 border-l-amber-400", selected ? "bg-accent" : "hover:bg-accent/50")}
    >
      {/* Ignorar (archivar): saca la conversación de la lista. Hover en desktop, visible en móvil. */}
      <button
        type="button"
        title="Ignorar (archivar) — no es una consulta"
        onClick={(e) => { e.stopPropagation(); onIgnore(conv.id) }}
        className="absolute right-1.5 bottom-1.5 z-10 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background opacity-60 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
      >
        <Archive className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-2 min-w-0">
        <div className="h-8 w-8 shrink-0 rounded-full bg-muted flex items-center justify-center">
          <UserCircle2 className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <ChannelIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium truncate">{conv.contact_name}</span>
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">{relativeTime(conv.last_message_at)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5 min-w-0">
            <span className={`text-xs truncate min-w-0 ${conv.unread_count > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
              {conv.last_message_preview ?? ""}
            </span>
            {conv.unread_count > 0 && (
              <Badge variant="default" className="h-4 min-w-4 px-1 text-[10px] shrink-0 rounded-full">{conv.unread_count}</Badge>
            )}
          </div>
          {conv.linked_client_name ? (
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">Cliente: {conv.linked_client_name}</div>
          ) : lead ? (
            <div className="text-[10px] mt-0.5 truncate flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5 text-amber-500 shrink-0" />
              <span className="text-muted-foreground">Lead · {LEAD_STATUS_LABEL[lead.status as LeadStatus] ?? lead.status}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// CENTER — thread + composer
// -----------------------------------------------------------------------------

function Thread({ conversation, templates, className, onBack, onShowContact }: { conversation: Conversation | null; templates: Template[]; className?: string; onBack?: () => void; onShowContact?: () => void }) {
  const confirm = useConfirm()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [composerError, setComposerError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const lastIdRef = useRef<string | null>(null)   // último mensaje conocido (para detectar nuevos al pollear)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const aiEnabled = useApi<{ configured: boolean }>("/api/ai/status").data?.configured ?? false

  // Enviar un archivo (PDF/imagen) al cliente por el canal de la conversación. Aparece en el chat al pollear.
  const sendFile = async (file: File) => {
    if (!conversation || !file) return
    if (!/pdf|image\//i.test(file.type) && !/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) { alert("Solo PDF o imágenes."); return }
    setUploading(true)
    try {
      const dataUrl: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file) })
      const r = await fetch(`/api/conversations/${conversation.id}/send-file`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data_base64: dataUrl.split(",")[1], filename: file.name, content_type: file.type }),
      })
      const j = await r.json().catch(() => ({}))
      if (!j.ok) alert("No se pudo enviar el archivo: " + (j.delivery?.reason || j.error || "error") + (j.url ? "\n\nLink:\n" + j.url : ""))
    } catch (e: any) { alert("Error: " + String(e?.message || e)) } finally { setUploading(false) }
  }

  // Load messages whenever the selected conversation changes
  useEffect(() => {
    setMessages([]); lastIdRef.current = null
    if (!conversation) return
    let cancelled = false
    setLoading(true)
    getJSON<Message[]>(`/api/conversations/${conversation.id}/messages`)
      .then((d) => { if (!cancelled) { setMessages(d); lastIdRef.current = d[d.length - 1]?.id ?? null } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    // Mark as read (fire-and-forget)
    fetch(`/api/conversations/${conversation.id}/read`, { method: "POST" }).catch(() => {})
    return () => { cancelled = true }
  }, [conversation?.id])

  // Auto-refresh: pollea los mensajes de la conversación abierta cada 5s. Solo actualiza
  // (y reposiciona el scroll) cuando llega un mensaje nuevo → no molesta mientras leés/escribís.
  useEffect(() => {
    if (!conversation) return
    const cid = conversation.id
    const tick = () => getJSON<Message[]>(`/api/conversations/${cid}/messages`)
      .then((d) => {
        const last = d[d.length - 1]?.id ?? null
        if (last === lastIdRef.current) return   // nada nuevo
        lastIdRef.current = last
        setMessages(d)
        fetch(`/api/conversations/${cid}/read`, { method: "POST" }).catch(() => {})   // ya está abierta → leída
      })
      .catch(() => {})
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [conversation?.id])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  if (!conversation) {
    return (
      <section className={cn("items-center justify-center border-y border-border bg-muted/20 text-sm text-muted-foreground", className)}>
        Seleccioná una conversación
      </section>
    )
  }

  const handleSend = async () => {
    const body = draft.trim()
    if (!body || sending) return
    // Email: confirmar antes de enviar (con Shift+Enter se escapaban mails sin querer).
    if (conversation.channel === "email") {
      const ok = await confirm({
        title: "Enviar email",
        description: `Se va a enviar el email a ${conversation.contact_id}. ¿Confirmás?`,
        confirmLabel: "Enviar email",
      })
      if (!ok) return
    }
    setSending(true); setComposerError(null)
    try {
      const r = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      const msg = (await r.json()) as Message
      setMessages(prev => [...prev, msg])
      lastIdRef.current = msg.id
      setDraft("")
    } catch (e: any) {
      setComposerError(e?.message ?? "Error")
    } finally {
      setSending(false)
    }
  }

  const insertText = (txt: string) => {
    setDraft(d => d + (d && !d.endsWith(" ") ? " " : "") + txt)
    setTimeout(() => taRef.current?.focus(), 0)
  }
  // IA: redacta un borrador y lo pone en el composer para editar y enviar (no envía).
  const onSuggest = async () => {
    if (!conversation || suggesting) return
    setSuggesting(true); setComposerError(null)
    try {
      const r = await api.suggestReply(conversation.id)
      if (r?.suggestion) { setDraft(r.suggestion); setTimeout(() => taRef.current?.focus(), 0) }
    } catch (e: any) { setComposerError(e?.message ?? "No se pudo generar la sugerencia") }
    finally { setSuggesting(false) }
  }

  // Plantillas aprobadas del canal de la conversación (o las marcadas "Todos")
  const availableTemplates = templates.filter(t => (t.channel === conversation.channel || t.channel === "all") && t.status === "approved")
  // Sugerencias interactivas: según el último mensaje recibido del cliente. (Consts planas,
  // no hooks — este bloque corre después del early-return de arriba.)
  const lastInbound = [...messages].reverse().find(m => m.direction === "in")?.body || ""
  const suggestions = suggestTemplates(availableTemplates, lastInbound, conversation.channel, 3)

  return (
    <section
      className={cn("relative flex-col border-y border-border bg-background overflow-hidden min-h-0", className)}
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) sendFile(f) }}
    >
      {(dragOver || uploading) && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/85 border-2 border-dashed border-primary rounded-md m-2 text-sm text-muted-foreground pointer-events-none">
          {uploading ? "Enviando archivo…" : "Soltá el PDF o imagen para enviarlo al cliente"}
        </div>
      )}
      <ThreadHeader conversation={conversation} onBack={onBack} onShowContact={onShowContact} />
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-muted/20">
        {loading ? (
          <div className="text-xs text-muted-foreground text-center py-10">Cargando…</div>
        ) : messages.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-10">Sin mensajes</div>
        ) : messages.map((m, i) => {
          const prev = messages[i - 1]
          const showDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString()
          return (
            <div key={m.id}>
              {showDay && (
                <div className="text-center my-2">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-background px-2 py-0.5 rounded-md border border-border">
                    {new Date(m.ts).toLocaleDateString("es-AR", { day: "numeric", month: "long" })}
                  </span>
                </div>
              )}
              <Bubble msg={m} />
            </div>
          )
        })}
      </div>
      {suggestions.length > 0 && (
        <div className="border-t border-border bg-background px-3 pt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><Sparkles className="h-3 w-3 text-amber-500" />Sugerencias:</span>
          {suggestions.map(t => (
            <button key={t.id} type="button" title={t.body}
              onClick={() => insertText(fillTemplate(t.body, conversation.contact_name))}
              className="text-[11px] rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              {t.name}
            </button>
          ))}
        </div>
      )}
      <Composer
        draft={draft}
        setDraft={setDraft}
        onSend={handleSend}
        sending={sending}
        error={composerError}
        templates={availableTemplates}
        onPickTemplate={(t) => insertText(fillTemplate(t.body, conversation.contact_name))}
        onPickEmoji={(e) => insertText(e)}
        taRef={taRef}
        onFile={sendFile}
        aiEnabled={aiEnabled}
        onSuggest={onSuggest}
        suggesting={suggesting}
      />
    </section>
  )
}

function ThreadHeader({ conversation, onBack, onShowContact }: { conversation: Conversation; onBack?: () => void; onShowContact?: () => void }) {
  const ChannelIcon = channelIcon(conversation.channel) ?? AtSign
  const isClosed = conversation.status === "closed"
  const patchConv = async (body: Partial<Conversation>) => {
    try {
      await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      refresh()
    } catch { /* ignore */ }
  }
  return (
    <div className="px-4 py-2.5 border-b border-border flex items-center gap-3 shrink-0 bg-background">
      {onBack && (
        <Button variant="ghost" size="icon" className="h-8 w-8 -ml-1 lg:hidden" aria-label="Volver a la lista" onClick={onBack}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
      )}
      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
        <UserCircle2 className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-2">
          {conversation.contact_name}
          {isClosed && <Badge variant="muted" className="text-[10px]">Cerrada</Badge>}
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <ChannelIcon className="h-3 w-3" />{CHANNEL_LABEL[conversation.channel]} · {conversation.contact_id}
        </div>
      </div>
      {onShowContact && (
        <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" aria-label="Ver ficha del contacto" onClick={onShowContact}>
          <Info className="h-4 w-4" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Opciones de la conversación"><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => patchConv({ unread_count: 1 })}>Marcar como no leída</DropdownMenuItem>
          {isClosed
            ? <DropdownMenuItem onClick={() => patchConv({ status: "open" })}>Reabrir conversación</DropdownMenuItem>
            : <DropdownMenuItem onClick={() => patchConv({ status: "closed" })}>Cerrar / archivar</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

const DELIVERY_LABEL: Record<string, string> = { sent: "enviado", delivered: "entregado", read: "leído", received: "recibido", failed: "no enviado" }
function Bubble({ msg }: { msg: Message }) {
  const isOut = msg.direction === "out"
  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-lg px-3 py-2 shadow-sm ${isOut ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>
        {msg.template_name && (
          <div className={`text-[10px] mb-0.5 uppercase tracking-wide ${isOut ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
            Plantilla · {msg.template_name}
          </div>
        )}
        {msg.media_url && msg.media_type === "image" && (
          <a href={msg.media_url} target="_blank" rel="noreferrer">
            <img src={msg.media_url} alt="Foto" className="rounded-md max-h-64 max-w-full mb-1 object-cover" />
          </a>
        )}
        {msg.media_url && msg.media_type === "video" && (
          <video src={msg.media_url} controls className="rounded-md max-h-64 max-w-full mb-1" />
        )}
        {msg.media_url && msg.media_type === "audio" && (
          <audio src={msg.media_url} controls className="mb-1 w-full" />
        )}
        {/* el texto/placeholder se oculta cuando ya mostramos la media visual */}
        {!(msg.media_url && (msg.media_type === "image" || msg.media_type === "video" || msg.media_type === "audio")) && (
          <div className="text-sm whitespace-pre-wrap break-words">{msg.body}</div>
        )}
        {msg.media_url && msg.media_type === "file" && (
          <a href={msg.media_url} target="_blank" rel="noreferrer" className="text-xs underline">Abrir adjunto</a>
        )}
        <div className={`text-[10px] mt-1 ${isOut ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
          {new Date(msg.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
          {isOut && msg.status ? ` · ${DELIVERY_LABEL[msg.status] ?? msg.status}` : ""}
        </div>
      </div>
    </div>
  )
}

function Composer({
  draft, setDraft, onSend, sending, error, templates, onPickTemplate, onPickEmoji, taRef, onFile,
  aiEnabled, onSuggest, suggesting,
}: {
  draft: string
  setDraft: (s: string) => void
  onSend: () => void
  sending: boolean
  error: string | null
  templates: Template[]
  onPickTemplate: (t: Template) => void
  onPickEmoji: (e: string) => void
  taRef: React.RefObject<HTMLTextAreaElement | null>
  onFile: (f: File) => void
  aiEnabled?: boolean
  onSuggest?: () => void
  suggesting?: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter = salto de línea; Shift+Enter = enviar (para no mandar sin querer).
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }
  return (
    <div className="border-t border-border bg-background shrink-0">
      {error && <div className="px-4 py-1.5 text-xs text-destructive">Error al enviar: {error}</div>}
      <div className="flex items-end gap-2 p-3">
        <div className="flex gap-1">
          <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = "" }} />
          <Button variant="ghost" size="icon" className="h-9 w-9" type="button" title="Adjuntar PDF o imagen" onClick={() => fileRef.current?.click()}>
            <Paperclip className="h-4 w-4" />
          </Button>
          {aiEnabled && (
            <Button variant="ghost" size="icon" className="h-9 w-9" type="button" title="Sugerir respuesta (IA)" disabled={suggesting} onClick={onSuggest}>
              <Wand2 className={cn("h-4 w-4", suggesting && "animate-pulse text-amber-500")} />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" type="button" disabled={templates.length === 0}>
                <FileText className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80">
              <DropdownMenuLabel>Plantillas aprobadas</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {templates.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">Sin plantillas para este canal</div>
              ) : templates.map(t => (
                <DropdownMenuItem key={t.id} onClick={() => onPickTemplate(t)} className="flex flex-col items-start gap-0.5">
                  <span className="text-xs font-medium">{t.name}</span>
                  <span className="text-[11px] text-muted-foreground line-clamp-2 whitespace-normal">{t.body}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" type="button">
                <Smile className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <div className="grid grid-cols-8 gap-1 p-1">
                {EMOJIS.map(e => (
                  <button key={e} type="button" onClick={() => onPickEmoji(e)} className="h-7 w-7 hover:bg-accent rounded-md text-base flex items-center justify-center">{e}</button>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribí un mensaje… (Shift+Enter para enviar)"
          rows={3}
          className="flex-1 resize-y min-h-[72px] max-h-[60vh] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button size="icon" className="h-9 w-9 shrink-0" onClick={onSend} disabled={sending || !draft.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// RIGHT — contact panel
// -----------------------------------------------------------------------------

function ContactPanel({ conversation, clients, sales, leads, leadById, quotes, className, onClose }: { conversation: Conversation | null; clients: Client[]; sales: Sale[]; leads: Lead[]; leadById: Map<string, Lead>; quotes: Quote[]; className?: string; onClose?: () => void }) {
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [newQuoteOpen, setNewQuoteOpen] = useState(false)
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const linkExistingLead = async (leadId: string) => {
    if (!conversation) return
    try {
      await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linked_lead_id: leadId }),
      })
      setLinkPickerOpen(false); refresh()
    } catch { /* ignore */ }
  }
  const { state: authState } = useAuth()
  const currentUser = authState.status === "ready" ? authState.user : null
  const settings = useApi<{ sellers?: { name: string }[] }>("/api/settings").data
  const allSellers = settings?.sellers ?? []

  const updateLead = useAction(api.update)
  const handleAdvance = async (next: LeadStatus) => {
    if (!conversation?.linked_lead_id) return
    const r = await updateLead.run("leads", conversation.linked_lead_id, { status: next, last_touch_at: new Date().toISOString() })
    if (r) refresh()
  }
  const handleAssign = async (sellerName: string) => {
    if (!conversation?.linked_lead_id) return
    const r = await updateLead.run("leads", conversation.linked_lead_id, { assigned_seller: sellerName, last_touch_at: new Date().toISOString() })
    if (r) refresh()
  }

  if (!conversation) {
    return <aside className={cn("border border-border rounded-r-lg bg-card", className)} />
  }

  const linkedClient = conversation.linked_client_name
    ? clients.find(c => c.name === conversation.linked_client_name)
    : null
  const linkedLead = conversation.linked_lead_id ? leadById.get(conversation.linked_lead_id) : undefined
  const clientSales = linkedClient ? sales.filter(s => s.client_name === linkedClient.name) : []
  const totalBilled = clientSales.reduce((sum, s) => sum + (s.contract_total ?? 0), 0)
  const totalDue = clientSales.reduce((sum, s) => sum + (s.financial_position?.balance_due ?? 0), 0)

  // Build LeadForm prefill from the conversation (and any linked client we already have)
  const initialLead: Partial<Lead> = {
    name: linkedClient?.name ?? conversation.contact_name,
    phone: conversation.channel === "whatsapp"
      ? conversation.contact_id
      : (linkedClient?.phones?.[0] ?? ""),
    email: conversation.channel === "email" ? conversation.contact_id : (linkedClient?.emails?.[0] ?? ""),
    source: conversation.channel === "whatsapp" ? "WhatsApp" : conversation.channel === "email" ? "Email" : "Instagram",
    status: "New",
    address: linkedClient?.addresses?.[0] ?? "",
    notes: [
      conversation.channel === "instagram" ? `IG: ${conversation.contact_id}` : "",
      conversation.last_message_preview ? `Último mensaje: ${conversation.last_message_preview}` : "",
    ].filter(Boolean).join("  ·  "),
  }

  const handleLeadCreated = async (lead: Lead) => {
    // Link the new lead back to the conversation so the next refresh shows it
    try {
      await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linked_lead_id: lead.id }),
      })
    } catch { /* ignore */ }
    refresh()
  }

  // Quote prefill from linked lead (button is disabled when no lead linked)
  const quotePrefill: QuotePrefill | null = linkedLead ? {
    lead_id: linkedLead.id,
    client_name: linkedLead.name,
    client_phone: linkedLead.phone,
    client_email: linkedLead.email,
    client_address: linkedLead.address,
    title: `Cotización ${linkedLead.name}`,
    internal_notes: linkedLead.notes,
    source: linkedLead.source,
    interested_products: linkedLead.interested_products,
    approx_m2: linkedLead.approx_m2,
  } : null

  // Quotes already created for this lead — listed in a dedicated section below
  const leadQuotes = linkedLead ? quotes.filter(q => q.lead_id === linkedLead.id) : []
  // Sales reached through this lead's converted quotes (quote.sale_id → sale.id)
  const leadSaleIds = new Set(leadQuotes.map(q => q.sale_id).filter(Boolean) as string[])
  const leadSales = linkedLead && leadSaleIds.size > 0 ? sales.filter(s => leadSaleIds.has(s.id)) : []

  // Cotizaciones del contacto (no solo del lead): por lead, cliente vinculado, teléfono o email.
  // OJO: cálculo plano (no useMemo) — este bloque corre después del early-return de arriba,
  // así que un hook acá rompería las reglas de hooks (cuenta de hooks variable).
  const convPhone = conversation.channel === "whatsapp" ? digits(conversation.contact_id) : ""
  const convEmail = conversation.channel === "email" ? conversation.contact_id.toLowerCase() : ""
  const convNames = [conversation.linked_client_name, linkedLead?.name, conversation.contact_name].filter(Boolean).map(s => (s as string).toLowerCase())
  const contactQuotes = quotes.filter(q => {
      if (linkedLead && q.lead_id === linkedLead.id) return true
      if (q.client_name && convNames.includes(q.client_name.toLowerCase())) return true
      if (convPhone.length >= 8 && digits(q.client_phone).endsWith(convPhone.slice(-8))) return true
      if (convEmail && (q.client_email || "").toLowerCase() === convEmail) return true
      return false
  })

  const handleQuoteCreated = async (q: Quote) => {
    // Auto-generate the branded PDF so the vendor can drag it straight into the chat
    try {
      openPacificPdf("quotes", q.id)
    } catch (e) { console.warn("PDF generation failed:", e) }

    // Auto-advance lead to "Cotizado" (only if not already further forward)
    if (linkedLead) {
      const isAlreadyForward = linkedLead.status === "Quoted" || linkedLead.status === "Won"
      if (!isAlreadyForward) {
        try {
          await fetch(`/api/leads/${linkedLead.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "Quoted", last_touch_at: new Date().toISOString() }),
          })
        } catch { /* ignore */ }
      }
    }
    refresh()
  }

  return (
    <>
    <aside className={cn("flex-col border border-border rounded-r-lg bg-card overflow-hidden", className)}>
      {onClose && (
        <div className="lg:hidden p-2 border-b border-border shrink-0">
          <Button variant="ghost" size="sm" className="h-8" onClick={onClose}><ChevronLeft className="h-4 w-4" />Volver al chat</Button>
        </div>
      )}
      <div className="p-4 border-b border-border flex flex-col items-center text-center shrink-0">
        <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-2">
          <UserCircle2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-sm font-medium">{conversation.contact_name}</div>
        <div className="text-[11px] text-muted-foreground">{CHANNEL_LABEL[conversation.channel]} · {conversation.contact_id}</div>
        {linkedClient ? (
          <Badge variant="outline" className="mt-2 text-[10px]">Cliente vinculado</Badge>
        ) : linkedLead ? (
          <Badge variant="outline" className="mt-2 text-[10px] gap-1"><Sparkles className="h-2.5 w-2.5 text-amber-500" />Lead · {LEAD_STATUS_LABEL[linkedLead.status as LeadStatus] ?? linkedLead.status}</Badge>
        ) : (
          <Badge variant="muted" className="mt-2 text-[10px]">Sin vincular</Badge>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-xs">
        {linkedLead && (
          <Section title="Lead">
            <Row icon={Sparkles} label="Estado" value={LEAD_STATUS_LABEL[linkedLead.status as LeadStatus] ?? linkedLead.status} />
            <Row icon={UserCircle2} label="Origen" value={linkedLead.source} />
            <div className="flex items-start gap-2 min-w-0 pt-0.5">
              <UserCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-muted-foreground">Vendedor</div>
                {linkedLead.assigned_seller ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs truncate">{linkedLead.assigned_seller}</span>
                    {currentUser?.role === "admin" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="text-[10px] text-primary hover:underline">Reasignar</button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuLabel>Asignar a</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {allSellers.map(s => <DropdownMenuItem key={s.name} onClick={() => handleAssign(s.name)}>{s.name}</DropdownMenuItem>)}
                          <DropdownMenuItem onClick={() => handleAssign("")} className="text-muted-foreground">— Sin asignar —</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground italic">Sin asignar</span>
                    {currentUser?.role === "vendor" ? (
                      <button type="button" onClick={() => handleAssign(currentUser.seller_name)} className="text-[10px] text-primary hover:underline">Asignarme</button>
                    ) : currentUser?.role === "admin" ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="text-[10px] text-primary hover:underline">Asignar</button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuLabel>Asignar a</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {allSellers.map(s => <DropdownMenuItem key={s.name} onClick={() => handleAssign(s.name)}>{s.name}</DropdownMenuItem>)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
            {linkedLead.interested_products?.length ? <Row icon={FileText} label="Interés" value={linkedLead.interested_products.join(", ")} /> : null}
            {linkedLead.notes && <Row icon={FileText} label="Notas" value={linkedLead.notes} />}
          </Section>
        )}

        {linkedClient && (
          <Section title="Cliente">
            <Row icon={UserCircle2} label="Nombre" value={linkedClient.name} />
            {linkedClient.dni && <Row icon={UserCircle2} label="DNI" value={linkedClient.dni} />}
            {linkedClient.phones?.[0] && <Row icon={Phone} label="Teléfono" value={linkedClient.phones[0]} />}
            {linkedClient.emails?.[0] && <Row icon={Mail} label="Email" value={linkedClient.emails[0]} />}
          </Section>
        )}

        {linkedClient && (
          <Section title="Resumen comercial">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Ventas" value={clientSales.length.toString()} />
              <Stat label="Facturado" value={fmtMoney(totalBilled)} />
              <Stat label="Por cobrar" value={fmtMoney(totalDue)} highlight={totalDue > 0} />
              <Stat label="Última" value={clientSales[0]?.created_at ? new Date(clientSales[0].created_at).toLocaleDateString("es-AR") : "—"} />
            </div>
          </Section>
        )}

        {linkedClient && clientSales.length > 0 && (
          <Section title="Últimas ventas">
            <div className="space-y-1.5">
              {clientSales.slice(0, 3).map(s => (
                <div key={s.id} className="rounded-md border border-border px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate">{s.id}</span>
                    <span className="tabular">{fmtMoney(s.contract_total ?? 0)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">{s.status ?? ""}{s.created_at ? ` · ${new Date(s.created_at).toLocaleDateString("es-AR")}` : ""}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {contactQuotes.length > 0 && (
          <Section title={`Compartir presupuesto (${contactQuotes.length})`}>
            <div className="space-y-1.5">
              {contactQuotes.map(q => <LeadQuoteRow key={q.id} quote={q} conversation={conversation} />)}
            </div>
          </Section>
        )}

        {leadSales.length > 0 && (
          <Section title={`Ventas vinculadas (${leadSales.length})`}>
            <div className="space-y-1.5">
              {leadSales.map(s => <LeadSaleRow key={s.id} sale={s} />)}
            </div>
          </Section>
        )}
      </div>

      <div className="p-3 border-t border-border space-y-2 shrink-0">
        {linkedLead && linkedLead.status !== "Won" && linkedLead.status !== "Lost" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="w-full" size="sm">
                Avanzar lead <ChevronRight className="h-3.5 w-3.5 ml-auto" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Estado del lead</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {LEAD_STATUS_ORDER.filter(s => s !== linkedLead.status).map((s) => (
                <DropdownMenuItem key={s} onClick={() => handleAdvance(s)} className={s === "Lost" ? "text-destructive" : ""}>
                  {LEAD_STATUS_LABEL[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          className="w-full"
          size="sm"
          variant={linkedLead || linkedClient ? "default" : "outline"}
          disabled={!linkedLead}
          onClick={() => setNewQuoteOpen(true)}
          title={linkedLead ? "Crear cotización desde este lead" : "Primero creá un lead"}
        >
          <FileText className="h-3.5 w-3.5" />Crear cotización
        </Button>
        {!linkedClient && !linkedLead && (
          <>
            {linkPickerOpen ? (
              <SearchPicker
                autoFocus
                placeholder="Buscar lead por nombre, email o teléfono…"
                items={leads.map((l) => ({ id: l.id, label: l.name, sub: l.email || l.phone || "", keywords: `${l.email || ""} ${l.phone || ""}` }))}
                onPick={linkExistingLead}
              />
            ) : (
              <Button className="w-full" size="sm" variant="outline" onClick={() => setLinkPickerOpen(true)}>
                <Sparkles className="h-3.5 w-3.5" />Vincular a lead existente
              </Button>
            )}
            <Button className="w-full" size="sm" onClick={() => setNewLeadOpen(true)}>
              <Sparkles className="h-3.5 w-3.5" />Crear lead nuevo
            </Button>
            <Button asChild variant="outline" className="w-full" size="sm">
              <Link to="/clientes">
                <UserCircle2 className="h-3.5 w-3.5" />Vincular a cliente
              </Link>
            </Button>
          </>
        )}
        {linkedLead && (
          <Button asChild variant="outline" className="w-full" size="sm">
            <Link to="/leads">
              <ExternalLink className="h-3.5 w-3.5" />Ver lead
            </Link>
          </Button>
        )}
        {linkedClient && (
          <Button asChild variant="outline" className="w-full" size="sm">
            <Link to="/clientes">
              <ExternalLink className="h-3.5 w-3.5" />Ver ficha de cliente
            </Link>
          </Button>
        )}
      </div>
    </aside>
    <LeadForm open={newLeadOpen} onOpenChange={setNewLeadOpen} initial={initialLead} onCreated={handleLeadCreated} />
    {quotePrefill && (
      <QuoteForm open={newQuoteOpen} onOpenChange={setNewQuoteOpen} prefill={quotePrefill} onCreated={handleQuoteCreated} />
    )}
    </>
  )
}

function LeadSaleRow({ sale }: { sale: Sale }) {
  const due = sale.financial_position?.balance_due ?? 0
  const total = sale.contract_total ?? 0
  const paid = sale.financial_position?.total_paid ?? 0
  const statusVariant =
    sale.status === "Finalizado" ? "default" :
    sale.status === "Cancelado" ? "destructive" :
    "outline"
  return (
    <Link to="/ventas" className="block rounded-md border border-border px-2 py-1.5 hover:bg-accent transition-colors">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium truncate">#{sale.quote_number}</span>
        <span className="tabular text-xs">{fmtMoney(total)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap text-[10px]">
        <Badge variant={statusVariant as any} className="text-[10px]">{sale.status}</Badge>
        {sale.delivery_date ? (
          <span className="text-muted-foreground">Entrega {new Date(sale.delivery_date).toLocaleDateString("es-AR")}</span>
        ) : (
          <span className="text-muted-foreground italic">Sin entrega programada</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 mt-1 text-[10px] tabular">
        <span className="text-muted-foreground">Cobrado {fmtMoney(paid)}</span>
        <span className={due > 0 ? "text-amber-700 font-medium" : "text-emerald-700"}>{due > 0 ? `Pendiente ${fmtMoney(due)}` : "✓ Pagado"}</span>
      </div>
    </Link>
  )
}

function LeadQuoteRow({ quote, conversation }: { quote: Quote; conversation: Conversation }) {
  const sentLabels = new Set(["Enviado", "SENT"])
  const acceptedLabels = new Set(["Aceptado", "ACCEPTED"])
  const status = quote.status
  const variant = acceptedLabels.has(status) ? "default" : sentLabels.has(status) ? "outline" : "muted"
  const handlePdf = () => openPacificPdf("quotes", quote.id)
  const markSent = async () => {
    try { await fetch(`/api/quotes/${quote.id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Enviado" }) }) } catch { /* ignore */ }
    refresh()
  }

  // Compartir el presupuesto EN esta conversación: WhatsApp manda el PDF como documento;
  // email manda el link en el cuerpo (+ firma); Instagram manda el link. Queda en el chat.
  const [sharing, setSharing] = useState(false)
  const [composing, setComposing] = useState(false)
  const defaultMsg = quoteShareMessage(quote)
  const [msg, setMsg] = useState(defaultMsg)
  const shareLabel = conversation.channel === "whatsapp" ? "Enviar PDF" : conversation.channel === "email" ? "Enviar por mail" : "Enviar link"
  const handleShare = async () => {
    setSharing(true)
    try {
      const r = await fetch(`/api/conversations/${conversation.id}/share-quote`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quote_id: quote.id, message: msg.trim() }),
      })
      const j = await r.json().catch(() => ({}))
      if (j.ok) refresh()
      else { alert("No se pudo enviar el presupuesto: " + (j.delivery?.reason || "revisá la conexión del canal") + (j.link ? "\n\nLink para compartir a mano:\n" + j.link : "")); setSharing(false) }
    } catch (e: any) { alert("Error: " + String(e?.message || e)); setSharing(false) }
  }

  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium truncate">#{quote.quote_number}{quote.title ? ` · ${quote.title}` : ""}</span>
        <span className="tabular text-xs">{fmtMoney(quote.price ?? 0)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Badge variant={variant as any} className="text-[10px]">{statusLabel(status)}</Badge>
        <div className="flex gap-2">
          <button type="button" onClick={handlePdf} className="text-[10px] text-primary hover:underline">PDF</button>
          <button type="button" onClick={() => { setMsg(defaultMsg); setComposing(c => !c) }} className="text-[10px] text-emerald-600 hover:underline">{shareLabel}</button>
          {!sentLabels.has(status) && !acceptedLabels.has(status) && (
            <button type="button" onClick={markSent} className="text-[10px] text-muted-foreground hover:underline">Marcar enviada</button>
          )}
        </div>
      </div>
      {composing && (
        <div className="mt-2 space-y-1.5">
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3}
            className="w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-xs"
            placeholder="Mensaje para el cliente…" />
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setComposing(false)} className="text-[10px] text-muted-foreground hover:underline">Cancelar</button>
            <Button size="sm" className="h-7 text-xs" disabled={sharing || !msg.trim()} onClick={handleShare}>{sharing ? "Enviando…" : "Enviar con el PDF"}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Row({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className="text-xs truncate">{value}</div>
      </div>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tabular text-xs mt-0.5 ${highlight ? "font-medium text-foreground" : ""}`}>{value}</div>
    </div>
  )
}
