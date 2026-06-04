import { useEffect, useMemo, useRef, useState } from "react"
import { Search, Send, Smile, FileText, Phone, Mail, ExternalLink, MoreHorizontal, UserCircle2, MessageCircle, AtSign, Sparkles, ChevronRight } from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { useApi, getJSON } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { useAuth } from "@/contexts/AuthContext"
import { type Conversation, type Message, type Template, type Channel, CHANNEL_LABEL, relativeTime, EMOJIS } from "@/lib/messaging"
import { type Lead, type LeadStatus, STATUS_ORDER as LEAD_STATUS_ORDER, STATUS_LABEL as LEAD_STATUS_LABEL } from "@/lib/leads"
import { LeadForm } from "@/components/forms/LeadForm"
import { QuoteForm, type QuotePrefill } from "@/components/forms/QuoteForm"
import { fmtMoney } from "@/lib/utils"
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
  const conversations = useApi<Conversation[]>("/api/conversations").data ?? []
  const templates = useApi<Template[]>("/api/templates").data ?? []
  const clients = useApi<Client[]>("/api/clients").data ?? []
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const leads = useApi<Lead[]>("/api/leads").data ?? []
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
  const [selectedId, setSelectedId] = useState<string | null>(convFromUrl)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return conversations.filter(c => {
      if (channelFilter !== "all" && c.channel !== channelFilter) return false
      if (!needle) return true
      return c.contact_name.toLowerCase().includes(needle)
        || c.contact_id.toLowerCase().includes(needle)
        || (c.last_message_preview ?? "").toLowerCase().includes(needle)
    })
  }, [conversations, channelFilter, q])

  // Default-select the first conversation when the list arrives
  useEffect(() => {
    if (selectedId == null && filtered.length > 0) setSelectedId(filtered[0].id)
  }, [filtered, selectedId])

  // When the URL changes (someone clicks a lead → /mensajes?conv=…) re-sync the selection
  useEffect(() => {
    if (convFromUrl && convFromUrl !== selectedId) setSelectedId(convFromUrl)
  }, [convFromUrl])

  // When the user picks a row manually, keep the URL in sync so refresh works
  const handleSelect = (id: string) => {
    setSelectedId(id)
    setSearchParams(prev => { prev.set("conv", id); return prev }, { replace: true })
  }

  const selected = conversations.find(c => c.id === selectedId) ?? null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-0 px-4 lg:px-6 min-h-0 overflow-hidden h-[calc(100svh-5.5rem)] md:h-[calc(100svh-6.5rem)]">
      <ConversationList
        conversations={filtered}
        total={conversations.length}
        selectedId={selectedId}
        onSelect={handleSelect}
        channelFilter={channelFilter}
        setChannelFilter={setChannelFilter}
        q={q}
        setQ={setQ}
        leadById={leadById}
      />
      <Thread conversation={selected} templates={templates} />
      <ContactPanel conversation={selected} clients={clients} sales={sales} leads={leads} leadById={leadById} quotes={quotes} />
    </div>
  )
}

// -----------------------------------------------------------------------------
// LEFT — conversation list
// -----------------------------------------------------------------------------

function ConversationList({
  conversations, total, selectedId, onSelect, channelFilter, setChannelFilter, q, setQ, leadById,
}: {
  conversations: Conversation[]
  total: number
  selectedId: string | null
  onSelect: (id: string) => void
  channelFilter: ChannelFilter
  setChannelFilter: (c: ChannelFilter) => void
  q: string
  setQ: (s: string) => void
  leadById: Map<string, Lead>
}) {
  return (
    <aside className="flex flex-col border border-border rounded-l-lg bg-card overflow-hidden">
      <div className="p-3 border-b border-border space-y-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conversación…" className="pl-8 h-8" />
        </div>
        <Tabs value={channelFilter} onValueChange={(v) => setChannelFilter(v as ChannelFilter)}>
          <TabsList className="h-8 w-full grid grid-cols-3">
            <TabsTrigger value="all" className="text-xs">Todas</TabsTrigger>
            <TabsTrigger value="whatsapp" className="text-xs gap-1"><MessageCircle className="h-3 w-3" />WA</TabsTrigger>
            <TabsTrigger value="instagram" className="text-xs gap-1"><AtSign className="h-3 w-3" />IG</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="text-[11px] text-muted-foreground">{conversations.length} de {total} conversaciones</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-10">Sin conversaciones</div>
        ) : conversations.map((c) => (
          <ConversationRow key={c.id} conv={c} lead={c.linked_lead_id ? leadById.get(c.linked_lead_id) : undefined} selected={c.id === selectedId} onClick={() => onSelect(c.id)} />
        ))}
      </div>
    </aside>
  )
}

function ConversationRow({ conv, lead, selected, onClick }: { conv: Conversation; lead?: Lead; selected: boolean; onClick: () => void }) {
  const ChannelIcon = conv.channel === "whatsapp" ? MessageCircle : AtSign
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-border transition-colors min-w-0 ${selected ? "bg-accent" : "hover:bg-accent/50"}`}
    >
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
    </button>
  )
}

// -----------------------------------------------------------------------------
// CENTER — thread + composer
// -----------------------------------------------------------------------------

function Thread({ conversation, templates }: { conversation: Conversation | null; templates: Template[] }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [composerError, setComposerError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Load messages whenever the selected conversation changes
  useEffect(() => {
    setMessages([])
    if (!conversation) return
    let cancelled = false
    setLoading(true)
    getJSON<Message[]>(`/api/conversations/${conversation.id}/messages`)
      .then((d) => { if (!cancelled) setMessages(d) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    // Mark as read (fire-and-forget)
    fetch(`/api/conversations/${conversation.id}/read`, { method: "POST" }).catch(() => {})
    return () => { cancelled = true }
  }, [conversation?.id])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  if (!conversation) {
    return (
      <section className="flex items-center justify-center border-y border-border bg-muted/20 text-sm text-muted-foreground">
        Seleccioná una conversación
      </section>
    )
  }

  const handleSend = async () => {
    const body = draft.trim()
    if (!body || sending) return
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

  // Only templates matching this conversation's channel + approved
  const availableTemplates = templates.filter(t => t.channel === conversation.channel && t.status === "approved")

  return (
    <section className="flex flex-col border-y border-border bg-background overflow-hidden min-h-0">
      <ThreadHeader conversation={conversation} />
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
      <Composer
        draft={draft}
        setDraft={setDraft}
        onSend={handleSend}
        sending={sending}
        error={composerError}
        templates={availableTemplates}
        onPickTemplate={(t) => insertText(t.body)}
        onPickEmoji={(e) => insertText(e)}
        taRef={taRef}
      />
    </section>
  )
}

function ThreadHeader({ conversation }: { conversation: Conversation }) {
  const ChannelIcon = conversation.channel === "whatsapp" ? MessageCircle : AtSign
  return (
    <div className="px-4 py-2.5 border-b border-border flex items-center gap-3 shrink-0 bg-background">
      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
        <UserCircle2 className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{conversation.contact_name}</div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <ChannelIcon className="h-3 w-3" />{CHANNEL_LABEL[conversation.channel]} · {conversation.contact_id}
        </div>
      </div>
      <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
    </div>
  )
}

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
        <div className="text-sm whitespace-pre-wrap break-words">{msg.body}</div>
        <div className={`text-[10px] mt-1 ${isOut ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
          {new Date(msg.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
          {isOut && msg.status ? ` · ${msg.status}` : ""}
        </div>
      </div>
    </div>
  )
}

function Composer({
  draft, setDraft, onSend, sending, error, templates, onPickTemplate, onPickEmoji, taRef,
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
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }
  return (
    <div className="border-t border-border bg-background shrink-0">
      {error && <div className="px-4 py-1.5 text-xs text-destructive">Error al enviar: {error}</div>}
      <div className="flex items-end gap-2 p-3">
        <div className="flex gap-1">
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
          placeholder="Escribí un mensaje…"
          rows={1}
          className="flex-1 resize-none min-h-9 max-h-32 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

function ContactPanel({ conversation, clients, sales, leads, leadById, quotes }: { conversation: Conversation | null; clients: Client[]; sales: Sale[]; leads: Lead[]; leadById: Map<string, Lead>; quotes: Quote[] }) {
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [newQuoteOpen, setNewQuoteOpen] = useState(false)
  void leads
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
    return <aside className="border border-border rounded-r-lg bg-card" />
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
    email: linkedClient?.emails?.[0] ?? "",
    source: conversation.channel === "whatsapp" ? "WhatsApp" : "Instagram",
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
    <aside className="flex flex-col border border-border rounded-r-lg bg-card overflow-hidden">
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

        {linkedLead && leadQuotes.length > 0 && (
          <Section title={`Cotizaciones del lead (${leadQuotes.length})`}>
            <div className="space-y-1.5">
              {leadQuotes.map(q => <LeadQuoteRow key={q.id} quote={q} conversation={conversation} linkedLead={linkedLead} />)}
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
            <Button className="w-full" size="sm" onClick={() => setNewLeadOpen(true)}>
              <Sparkles className="h-3.5 w-3.5" />Crear lead
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

function LeadQuoteRow({ quote, conversation, linkedLead }: { quote: Quote; conversation: Conversation; linkedLead?: Lead | null }) {
  void linkedLead
  const sentLabels = new Set(["Enviado", "SENT"])
  const acceptedLabels = new Set(["Aceptado", "ACCEPTED"])
  const status = quote.status
  const variant = acceptedLabels.has(status) ? "default" : sentLabels.has(status) ? "outline" : "muted"
  const handlePdf = () => openPacificPdf("quotes", quote.id)
  const markSent = async () => {
    try { await fetch(`/api/quotes/${quote.id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Enviado" }) }) } catch { /* ignore */ }
    refresh()
  }

  // Compartir por WhatsApp: posts the message INTO the current conversation thread (no external tab).
  // Once Meta API is wired (T6.D) the outbound message + PDF attachment relays to the client.
  // For now we also still download the PDF so the vendor has it handy in case they need to forward manually.
  const firstName = (quote.client_name || "").split(" ")[0] || ""
  const messageBody = `Hola${firstName ? " " + firstName : ""}, te paso la cotización #${quote.quote_number} por ${fmtMoney(quote.price ?? 0)}.\n\nLa adjunto en PDF. Cualquier consulta acá estoy. Gracias!`

  const handleWhatsApp = async () => {
    // Send message into the thread
    try {
      await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: messageBody }),
      })
    } catch { /* ignore */ }
    // Download PDF so the vendor can forward it via WhatsApp Web until Meta API is wired
    openPacificPdf("quotes", quote.id)
    // Auto-advance status to Enviado (only from Borrador/DRAFT)
    if (!sentLabels.has(status) && !acceptedLabels.has(status)) {
      try { await fetch(`/api/quotes/${quote.id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Enviado" }) }) } catch { /* ignore */ }
    }
    refresh()
  }

  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium truncate">#{quote.quote_number}</span>
        <span className="tabular text-xs">{fmtMoney(quote.price ?? 0)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Badge variant={variant as any} className="text-[10px]">{status}</Badge>
        <div className="flex gap-2">
          <button type="button" onClick={handlePdf} className="text-[10px] text-primary hover:underline">PDF</button>
          <button type="button" onClick={handleWhatsApp} className="text-[10px] text-emerald-600 hover:underline" title="Manda el mensaje en este mismo chat + descarga el PDF para adjuntar">Compartir en chat</button>
          {!sentLabels.has(status) && !acceptedLabels.has(status) && (
            <button type="button" onClick={markSent} className="text-[10px] text-muted-foreground hover:underline">Marcar enviada</button>
          )}
        </div>
      </div>
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
