import { useMemo, useState } from "react"
import { Plus, Search, LayoutGrid, Rows3, MoreHorizontal, Phone, Mail, MessageSquare, ExternalLink, Download, Clock, FileText } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { type Lead, type LeadStatus, STATUS_ORDER, STATUS_LABEL } from "@/lib/leads"
import { cn } from "@/lib/utils"
import { type Conversation, channelIcon } from "@/lib/messaging"
import { LeadForm } from "@/components/forms/LeadForm"
import { QuoteForm, type QuotePrefill } from "@/components/forms/QuoteForm"
import { useConfirm } from "@/components/ui/confirm"
import { openPacificPdf } from "@/lib/pdf"
import { fmtMoney } from "@/lib/utils"
import type { Quote } from "@/lib/types"

type View = "kanban" | "tabla"

export default function LeadsPage() {
  const leads = useApi<Lead[]>("/api/leads").data ?? []
  const conversations = useApi<Conversation[]>("/api/conversations").data ?? []
  const quotes = useApi<Quote[]>("/api/quotes").data ?? []
  const [view, setView] = useState<View>("kanban")
  const [q, setQ] = useState("")
  const [openNew, setOpenNew] = useState(false)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...leads]
      .sort((a, b) => (b.last_touch_at || "").localeCompare(a.last_touch_at || ""))
      .filter(l => !needle || l.name.toLowerCase().includes(needle) || (l.phone ?? "").includes(needle) || (l.notes ?? "").toLowerCase().includes(needle))
  }, [leads, q])

  const convByLeadId = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of conversations) if (c.linked_lead_id) m.set(c.linked_lead_id, c.id)
    return m
  }, [conversations])

  const quotesByLeadId = useMemo(() => {
    const m = new Map<string, Quote[]>()
    for (const qu of quotes) {
      if (!qu.lead_id) continue
      const arr = m.get(qu.lead_id) ?? []
      arr.push(qu); m.set(qu.lead_id, arr)
    }
    // Newest first
    for (const arr of m.values()) arr.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    return m
  }, [quotes])

  const selectedLead = selectedLeadId ? leads.find(l => l.id === selectedLeadId) ?? null : null

  // Detección de leads duplicados (mismo nombre completo, email o teléfono).
  const [mergingKey, setMergingKey] = useState<string | null>(null)
  const confirm = useConfirm()
  const dupGroups = useMemo(() => {
    const nrm = (s?: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()
    const dig = (s?: string) => (s || "").replace(/\D/g, "")
    const keyOf = (l: Lead) => {
      const nm = nrm(l.name)
      if (nm.length >= 5 && nm.includes(" ")) return "n:" + nm
      if (l.email) return "e:" + nrm(l.email)
      if (dig(l.phone).length >= 8) return "p:" + dig(l.phone).slice(-8)
      return "id:" + l.id
    }
    const m = new Map<string, Lead[]>()
    for (const l of leads) { const k = keyOf(l); const a = m.get(k) || []; a.push(l); m.set(k, a) }
    return [...m.entries()].filter(([, g]) => g.length >= 2)
  }, [leads])
  const score = (l: Lead) => (l.email ? 2 : 0) + (l.phone ? 1 : 0) + ((l.notes || "").length > 40 ? 1 : 0)
  const mergeGroup = async (key: string, group: Lead[]) => {
    const target = [...group].sort((a, b) => score(b) - score(a))[0]
    const others = group.filter((l) => l.id !== target.id)
    const ok = await confirm({
      title: "Unificar leads",
      description: `Se van a fusionar ${group.length} leads en uno: "${target.name}" (${target.email || target.phone || "sin contacto"}). Los otros (${others.map((l) => l.name).join(", ")}) se eliminan y sus conversaciones/cotizaciones pasan al primero. No se puede deshacer.`,
      confirmLabel: "Unificar",
      destructive: true,
    })
    if (!ok) return
    setMergingKey(key)
    try {
      for (const l of group) if (l.id !== target.id) await fetch(`/api/leads/${l.id}/merge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ into: target.id }) })
      refresh()
    } catch (e: any) { alert("Error al unificar: " + String(e?.message || e)); setMergingKey(null) }
  }

  return (
    <>
      <TopbarActions>
        <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" />Nuevo lead</Button>
      </TopbarActions>
      <div className="px-4 lg:px-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">{leads.length} leads · mostrando {rows.length}</div>
          <div className="flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList className="h-8">
                <TabsTrigger value="kanban" className="gap-1.5"><LayoutGrid className="h-3.5 w-3.5" />Kanban</TabsTrigger>
                <TabsTrigger value="tabla" className="gap-1.5"><Rows3 className="h-3.5 w-3.5" />Tabla</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, teléfono, notas…" className="pl-8 h-8" />
            </div>
          </div>
        </div>
        {dupGroups.length > 0 && (
          <Card className="border-amber-300 bg-amber-50/50 p-3 space-y-2">
            <div className="text-xs font-medium text-amber-800">Posibles duplicados ({dupGroups.length}) — mismo nombre, email o teléfono</div>
            {dupGroups.map(([key, group]) => (
              <div key={key} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0 truncate">
                  <span className="font-medium">{group[0].name}</span>
                  <span className="text-xs text-muted-foreground"> · {group.length} leads · {[...new Set(group.map(g => g.source))].join(", ")}</span>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" disabled={mergingKey === key} onClick={() => mergeGroup(key, group)}>{mergingKey === key ? "Unificando…" : "Unificar"}</Button>
              </div>
            ))}
          </Card>
        )}
        {leads.length === 0 ? (
          <Card className="px-6 py-10 text-center text-muted-foreground text-sm">
            Sin leads todavía. <button className="underline text-foreground" onClick={() => setOpenNew(true)}>Crear el primero</button>
          </Card>
        ) : view === "kanban" ? (
          <LeadsKanban rows={rows} onOpen={setSelectedLeadId} convByLeadId={convByLeadId} quotesByLeadId={quotesByLeadId} />
        ) : (
          <Card className="overflow-hidden py-0">
            <LeadsTable rows={rows} onOpen={setSelectedLeadId} convByLeadId={convByLeadId} quotesByLeadId={quotesByLeadId} />
          </Card>
        )}
      </div>
      <LeadForm open={openNew} onOpenChange={setOpenNew} />
      <LeadDetailSheet
        lead={selectedLead}
        onClose={() => setSelectedLeadId(null)}
        convId={selectedLead ? convByLeadId.get(selectedLead.id) : undefined}
        leadQuotes={selectedLead ? (quotesByLeadId.get(selectedLead.id) ?? []) : []}
      />
    </>
  )
}

// -----------------------------------------------------------------------------
// Kanban + Table
// -----------------------------------------------------------------------------

function LeadsKanban({ rows, onOpen, convByLeadId, quotesByLeadId }: { rows: Lead[]; onOpen: (id: string) => void; convByLeadId: Map<string, string>; quotesByLeadId: Map<string, Quote[]> }) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<LeadStatus | null>(null)
  const update = useAction(api.update)

  const byStatus = useMemo(() => {
    const m: Record<LeadStatus, Lead[]> = { New: [], Contacted: [], Quoted: [], Won: [], Lost: [] }
    for (const r of rows) (m[r.status as LeadStatus] ??= []).push(r)
    return m
  }, [rows])

  const handleDrop = async (status: LeadStatus, e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData("text/lead-id")
    setDragOverStatus(null); setDraggingId(null)
    if (!id) return
    const lead = rows.find(l => l.id === id)
    if (!lead || lead.status === status) return
    const r = await update.run("leads", id, { status, last_touch_at: new Date().toISOString() })
    if (r) refresh()
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
      {STATUS_ORDER.map((status) => {
        const list = byStatus[status] ?? []
        const isDropTarget = dragOverStatus === status
        return (
          <div
            key={status}
            className={cn(
              "bg-muted/40 rounded-lg border flex flex-col transition-colors",
              isDropTarget ? "border-primary bg-primary/5" : "border-border"
            )}
            onDragOver={(e) => { if (draggingId) { e.preventDefault(); setDragOverStatus(status) } }}
            onDragLeave={() => setDragOverStatus(prev => prev === status ? null : prev)}
            onDrop={(e) => handleDrop(status, e)}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wide flex items-center gap-2">
                {STATUS_LABEL[status]}
                <Badge variant="muted" className="text-[10px]">{list.length}</Badge>
              </div>
            </div>
            <div className="flex flex-col gap-2 p-2 min-h-[120px] max-h-[640px] overflow-y-auto">
              {list.length === 0 ? <div className="text-xs text-muted-foreground text-center py-6">Sin leads</div> : list.map((l) => (
                <LeadCard
                  key={l.id}
                  lead={l}
                  onOpen={onOpen}
                  hasConversation={convByLeadId.has(l.id)}
                  convId={convByLeadId.get(l.id)}
                  quotesCount={(quotesByLeadId.get(l.id) ?? []).length}
                  isDragging={draggingId === l.id}
                  onDragStart={(id) => setDraggingId(id)}
                  onDragEnd={() => { setDraggingId(null); setDragOverStatus(null) }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LeadsTable({ rows, onOpen, convByLeadId, quotesByLeadId }: { rows: Lead[]; onOpen: (id: string) => void; convByLeadId: Map<string, string>; quotesByLeadId: Map<string, Quote[]> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Origen</TableHead>
          <TableHead>Productos</TableHead>
          <TableHead>Vendedor</TableHead>
          <TableHead>Cotizado</TableHead>
          <TableHead>Último contacto</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="text-right">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((l) => {
          const lq = quotesByLeadId.get(l.id) ?? []
          const lqTotal = lq.reduce((sum, q) => sum + (q.price ?? 0), 0)
          return (
            <TableRow key={l.id} onClick={() => onOpen(l.id)} className="cursor-pointer">
              <TableCell>
                <div className="font-medium">{l.name}</div>
                <div className="text-xs text-muted-foreground">{l.phone ?? l.email ?? ""}</div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground"><SourceCell source={l.source} hasConv={convByLeadId.has(l.id)} /></TableCell>
              <TableCell className="text-xs max-w-[240px] truncate">{l.interested_products?.join(", ")}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{l.assigned_seller || "—"}</TableCell>
              <TableCell className="text-xs">
                {lq.length > 0 ? (
                  <span><Badge variant="outline" className="text-[10px] mr-1">{lq.length}</Badge>{fmtMoney(lqTotal)}</span>
                ) : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{l.last_touch_at ? new Date(l.last_touch_at).toLocaleDateString("es-AR") : "—"}</TableCell>
              <TableCell><Badge variant="outline">{STATUS_LABEL[l.status as LeadStatus] ?? l.status}</Badge></TableCell>
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <LeadRowActions lead={l} convId={convByLeadId.get(l.id)} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function SourceCell({ source, hasConv }: { source: string; hasConv: boolean }) {
  const s = source.toLowerCase()
  const Icon = channelIcon(s)
  return (
    <span className="inline-flex items-center gap-1">
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {source}
      {hasConv && s !== "web" ? <span className="text-[10px] text-emerald-600 ml-1">●</span> : null}
    </span>
  )
}

function LeadCard({ lead, onOpen, hasConversation, convId, quotesCount, isDragging, onDragStart, onDragEnd }: { lead: Lead; onOpen: (id: string) => void; hasConversation: boolean; convId?: string; quotesCount: number; isDragging?: boolean; onDragStart?: (id: string) => void; onDragEnd?: () => void }) {
  const src = (lead.source ?? "").toLowerCase()
  const SourceIcon = channelIcon(src)
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!!onDragStart}
      onDragStart={(e) => { e.dataTransfer.setData("text/lead-id", lead.id); e.dataTransfer.effectAllowed = "move"; onDragStart?.(lead.id) }}
      onDragEnd={() => onDragEnd?.()}
      onClick={() => onOpen(lead.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(lead.id) } }}
      className={cn(
        "group bg-card border border-border rounded-md p-3 hover:bg-accent transition-colors min-w-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring",
        isDragging && "opacity-50 ring-2 ring-primary"
      )}
      title="Ver detalle del lead · arrastrar para cambiar estado"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="text-sm font-medium truncate flex-1 min-w-0">{lead.name}</div>
        <div onClick={(e) => e.stopPropagation()}><LeadRowActions lead={lead} convId={convId} /></div>
      </div>
      <div className="space-y-0.5 text-[11px] text-muted-foreground min-w-0">
        {lead.phone ? (
          <div className="flex items-center gap-1 min-w-0">
            <Phone className="h-3 w-3 shrink-0" />
            <span className="truncate">{lead.phone}</span>
          </div>
        ) : null}
        {lead.email ? (
          <div className="flex items-center gap-1 min-w-0">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{lead.email}</span>
          </div>
        ) : null}
        {lead.address ? (
          <div className="text-[10px] truncate">{lead.address}{lead.approx_m2 ? ` · ${lead.approx_m2} m²` : ""}{lead.needs_placement != null ? ` · ${lead.needs_placement ? "con colocación" : "sin colocación"}` : ""}</div>
        ) : null}
      </div>
      {lead.interested_products?.length ? (
        <div className="text-xs text-muted-foreground line-clamp-2 mt-2">{lead.interested_products.join(", ")}</div>
      ) : null}
      <div className="flex items-center justify-between gap-2 mt-2 text-[10px] text-muted-foreground min-w-0">
        <Badge variant="muted" className="text-[10px] shrink-0 gap-1">
          {SourceIcon ? <SourceIcon className="h-2.5 w-2.5" /> : null}{lead.source}
          {hasConversation && src !== "web" ? <span className="text-emerald-600 ml-0.5">●</span> : null}
        </Badge>
        <span className="truncate">{lead.assigned_seller || "Sin asignar"}</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        {quotesCount > 0 && (
          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700">{quotesCount} cotización{quotesCount > 1 ? "es" : ""}</Badge>
        )}
        <AgeBadge lead={lead} />
      </div>
    </div>
  )
}

function AgeBadge({ lead }: { lead: Lead }) {
  // Terminal states don't need aging — the deal is decided.
  if (lead.status === "Won" || lead.status === "Lost") return null
  const last = new Date(lead.last_touch_at || lead.created_at)
  if (isNaN(+last)) return null
  const days = Math.floor((Date.now() - +last) / 86400000)
  if (days < 1) return null

  const label = `${days}d`
  if (days >= 14) {
    return <span className="inline-flex items-center gap-0.5 text-[10px] text-destructive font-medium" title={`Sin actividad hace ${days} días`}><Clock className="h-2.5 w-2.5" />{label}</span>
  }
  if (days >= 7) {
    return <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-700" title={`Sin actividad hace ${days} días`}><Clock className="h-2.5 w-2.5" />{label}</span>
  }
  return <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`Sin actividad hace ${days} días`}><Clock className="h-2.5 w-2.5" />{label}</span>
}

// -----------------------------------------------------------------------------
// Detail sheet (right-side drawer)
// -----------------------------------------------------------------------------

function LeadDetailSheet({ lead, onClose, convId, leadQuotes }: { lead: Lead | null; onClose: () => void; convId?: string; leadQuotes: Quote[] }) {
  const navigate = useNavigate()
  const [pdfQuoteId, setPdfQuoteId] = useState<string | null>(null)
  const [quoteOpen, setQuoteOpen] = useState(false)   // (hooks SIEMPRE antes del early-return)
  if (!lead) return null

  // Cotizar directo desde el lead (mismo prefill que usa Mensajes: guarda lead_id, sin crear cliente).
  const quotePrefill: QuotePrefill = {
    lead_id: lead.id, client_name: lead.name, client_phone: lead.phone, client_email: lead.email,
    client_address: lead.address, title: `Cotización ${lead.name}`, internal_notes: lead.notes,
    source: lead.source, interested_products: lead.interested_products, approx_m2: lead.approx_m2,
  }

  const quote = leadQuotes.find(q => q.id === pdfQuoteId) ?? leadQuotes[0] ?? null
  const totalEstimated = leadQuotes.reduce((sum, q) => sum + (q.price ?? 0), 0)

  // All items aggregated across all linked cotizaciones
  const aggregatedItems = leadQuotes.flatMap(q => (q.items ?? []).map(it => ({ ...it, _quote: q.quote_number })))

  const handleOpenChat = () => convId ? navigate(`/mensajes?conv=${convId}`) : navigate("/mensajes")
  const handleEmail = () => {
    if (!lead.email) return
    window.location.href = `mailto:${lead.email}?subject=${encodeURIComponent("Pisos Pacific — tu consulta")}&body=${encodeURIComponent(`Hola ${lead.name.split(" ")[0] ?? lead.name},\n\nGracias por tu consulta a Pisos Pacific.\n\n`)}`
  }

  return (
    <Sheet open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="!max-w-4xl w-full overflow-y-auto">
        <SheetHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle>{lead.name}</SheetTitle>
              <SheetDescription className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-[10px]">{STATUS_LABEL[lead.status as LeadStatus] ?? lead.status}</Badge>
                <span>·</span>
                <SourceCell source={lead.source} hasConv={!!convId} />
              </SheetDescription>
            </div>
            <div className="flex gap-2 mr-8">
              <Button size="sm" onClick={() => setQuoteOpen(true)}><FileText className="h-3.5 w-3.5" />Nueva cotización</Button>
              {convId && (
                <Button size="sm" variant="outline" onClick={handleOpenChat}><MessageSquare className="h-3.5 w-3.5" />Abrir chat</Button>
              )}
              {lead.email && (
                <Button size="sm" variant="outline" onClick={handleEmail}><Mail className="h-3.5 w-3.5" />Email</Button>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <DetailSection title="Datos del cliente">
            <DetailRow label="Nombre"   value={lead.name} />
            <DetailRow label="DNI/CUIT" value={(lead as any).dni ?? "—"} />
            <DetailRow label="Email"    value={lead.email ?? "—"} />
            <DetailRow label="Teléfono" value={lead.phone ?? "—"} />
            <DetailRow label="Dirección / obra" value={lead.address ?? "—"} />
            <DetailRow label="Vendedor" value={lead.assigned_seller || "Sin asignar"} />
            {lead.needs_placement != null && (
              <DetailRow label="Colocación" value={lead.needs_placement ? "Sí" : "No"} />
            )}
            {lead.approx_m2 != null && (
              <DetailRow label="m² aprox." value={`${lead.approx_m2}`} />
            )}
            {lead.interested_products?.length ? (
              <DetailRow label="Interés" value={lead.interested_products.join(", ")} />
            ) : null}
            {lead.notes && (
              <div className="mt-2 text-xs text-muted-foreground border-t border-border pt-2">{lead.notes}</div>
            )}
          </DetailSection>

          <DetailSection title={`Items cotizados (${aggregatedItems.length})`}>
            {aggregatedItems.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-2">Sin cotizaciones para este lead todavía.</div>
            ) : (
              <div className="space-y-1.5">
                {aggregatedItems.slice(0, 12).map((it: any, i) => (
                  <div key={i} className="rounded-md border border-border px-2 py-1.5 flex items-center justify-between text-xs gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{it.description}</div>
                      <div className="text-[10px] text-muted-foreground">{it.sku} · {it.quantity} × {fmtMoney(it.unit_price)} · {it._quote}</div>
                    </div>
                    <div className="tabular shrink-0">{fmtMoney((it.quantity || 0) * (it.unit_price || 0))}</div>
                  </div>
                ))}
                {aggregatedItems.length > 12 && (
                  <div className="text-[10px] text-muted-foreground text-center">…y {aggregatedItems.length - 12} ítems más</div>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Total estimado</span>
                  <span className="text-sm font-semibold tabular">{fmtMoney(totalEstimated)}</span>
                </div>
              </div>
            )}
          </DetailSection>
        </div>

        {/* PDF preview */}
        {leadQuotes.length > 0 && quote && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Preview de cotización</div>
              <div className="flex items-center gap-2">
                {leadQuotes.length > 1 && (
                  <select
                    value={quote.id}
                    onChange={(e) => setPdfQuoteId(e.target.value)}
                    className="h-7 rounded-md border border-input bg-transparent px-2 text-xs"
                  >
                    {leadQuotes.map(q => <option key={q.id} value={q.id}>#{q.quote_number} · {fmtMoney(q.price ?? 0)}</option>)}
                  </select>
                )}
                <Button size="sm" variant="outline" onClick={() => openPacificPdf("quotes", quote.id)}><Download className="h-3.5 w-3.5" />Descargar</Button>
              </div>
            </div>
            <div className="border border-border rounded-md overflow-hidden">
              <iframe title="Presupuesto" src={`/api/quotes/${quote.id}/pdf`} style={{ width: "100%", height: 560, border: 0 }} />
            </div>
          </div>
        )}
        <QuoteForm open={quoteOpen} onOpenChange={setQuoteOpen} prefill={quotePrefill} />
      </SheetContent>
    </Sheet>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground text-right truncate">{value}</span>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Row actions (three-dots dropdown)
// -----------------------------------------------------------------------------

function LeadRowActions({ lead, convId }: { lead: Lead; convId?: string }) {
  const navigate = useNavigate()
  const update = useAction(api.update)

  const handleAdvance = async (next: LeadStatus) => {
    const r = await update.run("leads", lead.id, { status: next, last_touch_at: new Date().toISOString() })
    if (r) refresh()
  }
  // (El "Convertir a cliente" manual se quitó: un lead se vuelve cliente al concretar la venta —
  //  marcar "Ganado" convierte la última cotización en venta y crea/asocia el cliente, deduplicado.)
  const handleChat  = () => convId ? navigate(`/mensajes?conv=${convId}`) : navigate("/mensajes")
  const handleEmail = () => {
    if (!lead.email) return
    window.location.href = `mailto:${lead.email}?subject=${encodeURIComponent("Pisos Pacific — tu consulta")}&body=${encodeURIComponent(`Hola ${lead.name.split(" ")[0] ?? lead.name},\n\n`)}`
  }
  const handleCall  = () => { if (lead.phone) window.location.href = `tel:${lead.phone.replace(/[^\d+]/g, "")}` }

  const next = (() => {
    switch (lead.status as LeadStatus) {
      case "New": return "Contacted" as const
      case "Contacted": return "Quoted" as const
      case "Quoted": return "Won" as const
      default: return null
    }
  })()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{lead.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {convId && <DropdownMenuItem onClick={handleChat}><MessageSquare className="h-3.5 w-3.5 mr-2" />Abrir chat</DropdownMenuItem>}
        {lead.email && <DropdownMenuItem onClick={handleEmail}><Mail className="h-3.5 w-3.5 mr-2" />Enviar email</DropdownMenuItem>}
        {lead.phone && <DropdownMenuItem onClick={handleCall}><Phone className="h-3.5 w-3.5 mr-2" />Llamar</DropdownMenuItem>}
        {(convId || lead.email || lead.phone) && <DropdownMenuSeparator />}
        {next && <DropdownMenuItem onClick={() => handleAdvance(next)}><ExternalLink className="h-3.5 w-3.5 mr-2" />Avanzar a {STATUS_LABEL[next]}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={() => handleAdvance("Lost")}>Marcar perdido</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
