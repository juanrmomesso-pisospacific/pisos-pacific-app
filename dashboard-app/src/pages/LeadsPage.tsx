import { useMemo, useState } from "react"
import { Plus, Search, LayoutGrid, Rows3, MoreHorizontal, Phone, Mail, UserPlus, Globe, MessageCircle, AtSign } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { type Lead, type LeadStatus, STATUS_ORDER, STATUS_LABEL } from "@/lib/leads"
import { type Conversation } from "@/lib/messaging"
import { LeadForm } from "@/components/forms/LeadForm"

type View = "kanban" | "tabla"

export default function LeadsPage() {
  const leads = useApi<Lead[]>("/api/leads").data ?? []
  const conversations = useApi<Conversation[]>("/api/conversations").data ?? []
  const navigate = useNavigate()
  const [view, setView] = useState<View>("kanban")
  const [q, setQ] = useState("")
  const [openNew, setOpenNew] = useState(false)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...leads]
      .sort((a, b) => (b.last_touch_at || "").localeCompare(a.last_touch_at || ""))
      .filter(l => !needle || l.name.toLowerCase().includes(needle) || (l.phone ?? "").includes(needle) || (l.notes ?? "").toLowerCase().includes(needle))
  }, [leads, q])

  // Build a quick lookup: lead.id → conversation id, so we can navigate to the chat
  const convByLeadId = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of conversations) if (c.linked_lead_id) m.set(c.linked_lead_id, c.id)
    return m
  }, [conversations])

  const openLead = (l: Lead) => {
    const convId = convByLeadId.get(l.id)
    if (convId) { navigate(`/mensajes?conv=${convId}`); return }
    // Source-based fallback
    const src = (l.source ?? "").toLowerCase()
    if (src === "web" && l.email) { window.location.href = `mailto:${l.email}?subject=${encodeURIComponent("Pisos Pacific — tu consulta")}&body=${encodeURIComponent(`Hola ${l.name.split(" ")[0] ?? l.name},\n\nGracias por tu consulta a Pisos Pacific. `)}`; return }
    if ((src === "whatsapp" || src === "instagram") && (l.phone || l.email)) { navigate("/mensajes"); return }
    if (l.email)  { window.location.href = `mailto:${l.email}`; return }
    if (l.phone)  { window.location.href = `https://wa.me/${l.phone.replace(/[^\d]/g, "")}`; return }
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
        {leads.length === 0 ? (
          <Card className="px-6 py-10 text-center text-muted-foreground text-sm">
            Sin leads todavía. <button className="underline text-foreground" onClick={() => setOpenNew(true)}>Crear el primero</button>
          </Card>
        ) : view === "kanban" ? <LeadsKanban rows={rows} onOpen={openLead} convByLeadId={convByLeadId} /> : (
          <Card className="overflow-hidden py-0"><LeadsTable rows={rows} onOpen={openLead} convByLeadId={convByLeadId} /></Card>
        )}
      </div>
      <LeadForm open={openNew} onOpenChange={setOpenNew} />
    </>
  )
}

function LeadsKanban({ rows, onOpen, convByLeadId }: { rows: Lead[]; onOpen: (l: Lead) => void; convByLeadId: Map<string, string> }) {
  const byStatus = useMemo(() => {
    const m: Record<LeadStatus, Lead[]> = { New: [], Contacted: [], Quoted: [], Won: [], Lost: [] }
    for (const r of rows) (m[r.status as LeadStatus] ??= []).push(r)
    return m
  }, [rows])

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
      {STATUS_ORDER.map((status) => {
        const list = byStatus[status] ?? []
        return (
          <div key={status} className="bg-muted/40 rounded-lg border border-border flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wide flex items-center gap-2">
                {STATUS_LABEL[status]}
                <Badge variant="muted" className="text-[10px]">{list.length}</Badge>
              </div>
            </div>
            <div className="flex flex-col gap-2 p-2 min-h-[120px] max-h-[640px] overflow-y-auto">
              {list.length === 0 ? <div className="text-xs text-muted-foreground text-center py-6">Sin leads</div> : list.map((l) => (
                <LeadCard key={l.id} lead={l} onOpen={onOpen} hasConversation={convByLeadId.has(l.id)} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LeadsTable({ rows, onOpen, convByLeadId }: { rows: Lead[]; onOpen: (l: Lead) => void; convByLeadId: Map<string, string> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Origen</TableHead>
          <TableHead>Productos</TableHead>
          <TableHead>Vendedor</TableHead>
          <TableHead>Último contacto</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="text-right">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((l) => (
          <TableRow key={l.id} onClick={() => onOpen(l)} className="cursor-pointer">
            <TableCell>
              <div className="font-medium">{l.name}</div>
              <div className="text-xs text-muted-foreground">{l.phone ?? l.email ?? ""}</div>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground"><SourceCell source={l.source} hasConv={convByLeadId.has(l.id)} /></TableCell>
            <TableCell className="text-xs max-w-[240px] truncate">{l.interested_products?.join(", ")}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{l.assigned_seller || "—"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{l.last_touch_at ? new Date(l.last_touch_at).toLocaleDateString("es-AR") : "—"}</TableCell>
            <TableCell><Badge variant="outline">{STATUS_LABEL[l.status as LeadStatus] ?? l.status}</Badge></TableCell>
            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}><LeadRowActions lead={l} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function SourceCell({ source, hasConv }: { source: string; hasConv: boolean }) {
  const s = source.toLowerCase()
  const Icon = s === "whatsapp" ? MessageCircle : s === "instagram" ? AtSign : s === "web" ? Globe : null
  return (
    <span className="inline-flex items-center gap-1">
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {source}
      {hasConv && s !== "web" ? <span className="text-[10px] text-emerald-600 ml-1">●</span> : null}
    </span>
  )
}

function LeadCard({ lead, onOpen, hasConversation }: { lead: Lead; onOpen: (l: Lead) => void; hasConversation: boolean }) {
  const src = (lead.source ?? "").toLowerCase()
  const SourceIcon = src === "whatsapp" ? MessageCircle : src === "instagram" ? AtSign : src === "web" ? Globe : null
  const target = hasConversation ? "Abrir chat" : src === "web" ? "Enviar email" : src === "whatsapp" || src === "instagram" ? "Abrir bandeja" : lead.email ? "Enviar email" : "Abrir contacto"
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(lead)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(lead) } }}
      className="group bg-card border border-border rounded-md p-3 hover:bg-accent transition-colors min-w-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
      title={target}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="text-sm font-medium truncate flex-1 min-w-0">{lead.name}</div>
        <div onClick={(e) => e.stopPropagation()}><LeadRowActions lead={lead} /></div>
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
      <div className="text-[10px] text-muted-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity mt-1.5 text-right">{target} →</div>
    </div>
  )
}

function LeadRowActions({ lead }: { lead: Lead }) {
  const update = useAction(api.update)
  const createClient = useAction(api.create)
  const handleAdvance = async (next: LeadStatus) => {
    const r = await update.run("leads", lead.id, { status: next, last_touch_at: new Date().toISOString() })
    if (r) refresh()
  }
  const handleConvert = async () => {
    // Create a client from the lead, mark lead Won
    const client = await createClient.run("clients", {
      name: lead.name,
      dni: "",
      type: "client",
      emails: lead.email ? [lead.email] : [],
      phones: lead.phone ? [lead.phone] : [],
      addresses: [],
      updated_at: new Date().toISOString(),
    })
    if (!client) return
    await update.run("leads", lead.id, { status: "Won", last_touch_at: new Date().toISOString() })
    refresh()
  }
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
        {next && <DropdownMenuItem onClick={() => handleAdvance(next)}>Avanzar a {STATUS_LABEL[next]}</DropdownMenuItem>}
        <DropdownMenuItem onClick={handleConvert}><UserPlus className="h-3.5 w-3.5 mr-2" />Convertir a cliente</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={() => handleAdvance("Lost")}>Marcar perdido</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
