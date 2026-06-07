import { useEffect, useMemo, useRef, useState } from "react"
import { Search, LayoutGrid, Rows3, Plus, Check, CalendarDays, Truck, Info, CalendarClock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { SaleRowActions } from "@/components/RowActions"
import { SaleForm } from "@/components/forms/SaleForm"
import { SearchPicker } from "@/components/SearchPicker"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import { useApi } from "@/lib/api"
import { api, useAction } from "@/lib/mutations"
import { fmtMoney, cn } from "@/lib/utils"
import { openPacificPdf } from "@/lib/pdf"
import type { Sale, Quote, Caja, CashflowMovement, Product } from "@/lib/types"

const STATUSES = ["Confirmado", "Programado", "En proceso", "Finalizado"] as const
type SaleStatus = (typeof STATUSES)[number]

// Status → header icon (per user spec). Finalizado intentionally has none.
const STATUS_ICON: Record<SaleStatus, React.ComponentType<{ className?: string }> | null> = {
  "Confirmado": Check,
  "Programado": CalendarDays,
  "En proceso": Truck,
  "Finalizado": null,
}

// Plain-language definition of what each column means — surfaced via the (i) tooltip.
const STATUS_INFO: Record<SaleStatus, string> = {
  "Confirmado": "El cliente confirmó la cotización y abonó el anticipo. Falta agendar la entrega.",
  "Programado": "El cliente eligió fecha de entrega. Estamos esperando el día.",
  "En proceso": "Entrega y/o instalación en curso ahora.",
  "Finalizado": "Entregado e instalado. Stock descontado y obra cerrada.",
}

// Monochrome key — darker = newer in pipeline (needs attention), fading to light = done.
// Each token has a paired light/dark-mode value so legibility works on both themes.
const STATUS_COLOR: Record<SaleStatus, { bar: string; tint: string; icon: string; dot: string; badge: string }> = {
  "Confirmado": {
    bar:   "bg-zinc-900 dark:bg-zinc-100",
    tint:  "bg-zinc-100/60 dark:bg-zinc-900/40",
    icon:  "text-zinc-900 dark:text-zinc-100",
    dot:   "bg-zinc-900 dark:bg-zinc-100",
    badge: "bg-zinc-900 text-zinc-50 border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100",
  },
  "Programado": {
    bar:   "bg-zinc-600 dark:bg-zinc-400",
    tint:  "bg-zinc-100/40 dark:bg-zinc-900/30",
    icon:  "text-zinc-700 dark:text-zinc-300",
    dot:   "bg-zinc-600 dark:bg-zinc-400",
    badge: "bg-zinc-200 text-zinc-900 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700",
  },
  "En proceso": {
    bar:   "bg-zinc-400 dark:bg-zinc-600",
    tint:  "bg-zinc-50/30 dark:bg-zinc-900/20",
    icon:  "text-zinc-500 dark:text-zinc-400",
    dot:   "bg-zinc-400 dark:bg-zinc-600",
    badge: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-200 dark:border-zinc-700",
  },
  "Finalizado": {
    bar:   "bg-zinc-300 dark:bg-zinc-700",
    tint:  "bg-zinc-50/20 dark:bg-zinc-900/10",
    icon:  "text-zinc-400 dark:text-zinc-500",
    dot:   "bg-zinc-300 dark:bg-zinc-700",
    badge: "bg-zinc-50 text-zinc-500 border-zinc-200 dark:bg-zinc-900/50 dark:text-zinc-400 dark:border-zinc-700",
  },
}

type View = "tabla" | "kanban"

// Delivery status (avance de obra) — what is delivered vs pending.
const DELIVERY_LABEL: Record<string, string> = { Finalizado: "Finalizado", Acopiado: "Acopiado", Agendado: "Agendado" }
function DeliveryBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-[10px] text-muted-foreground">Sin estado</span>
  const done = value === "Finalizado"
  return <Badge variant="outline" className={cn("text-[10px] font-normal", done ? "text-muted-foreground" : "text-foreground border-foreground/30")}>{DELIVERY_LABEL[value] ?? value}</Badge>
}
// Cobro/saldo: priorizar la conciliación del cashflow (ingresos linkeados a la venta);
// caer a financial_position si la venta todavía no tiene cobros en el cashflow.
const saldoDue = (s: Sale) => s.cashflow_balance_due ?? s.financial_position?.balance_due ?? 0
const cobrado = (s: Sale) => s.cashflow_paid ?? s.financial_position?.total_paid ?? 0
const isDue = (s: Sale) => saldoDue(s) > 0.5
const isPendingDelivery = (s: Sale) => s.delivery_status !== "Finalizado"

export default function VentasPage() {
  const salesApi = useApi<Sale[]>("/api/sales")
  const sales = salesApi.data ?? []
  const refetchSales = salesApi.refetch
  const sweptRef = useRef(false)
  // Conexión agenda → ventas: una venta Programada cuya entrega ya empezó pasa a "En proceso".
  useEffect(() => {
    if (sweptRef.current || sales.length === 0) return
    const today = new Date().toISOString().slice(0, 10)
    const due = sales.filter(s => s.status === "Programado" && s.delivery_date && s.delivery_date.slice(0, 10) <= today)
    if (due.length === 0) return
    sweptRef.current = true
    Promise.all(due.map(s => api.saleTransition(s.id, "En proceso").catch(() => null))).then(() => refetchSales())
  }, [sales])
  const [filter, setFilter] = useState<"Todas" | (typeof STATUSES)[number]>("Todas")
  const [quick, setQuick] = useState<"none" | "cobro" | "entrega">("none")
  const [q, setQ] = useState("")
  // Default is kanban; persist user choice across reloads (e.g. after drag-drop's refresh())
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "kanban"
    const saved = window.localStorage.getItem("ventas:view")
    return (saved === "tabla" || saved === "kanban") ? saved : "kanban"
  })
  const setViewPersist = (v: View) => {
    setView(v)
    if (typeof window !== "undefined") window.localStorage.setItem("ventas:view", v)
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...sales]
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .filter((row) => {
        if (filter !== "Todas" && row.status !== filter) return false
        if (quick === "cobro" && !isDue(row)) return false
        if (quick === "entrega" && !isPendingDelivery(row)) return false
        if (!needle) return true
        return row.client_name.toLowerCase().includes(needle) || row.quote_number.toLowerCase().includes(needle)
      })
  }, [sales, filter, quick, q])

  const counts = useMemo(() => {
    const c: Record<string, number> = { Todas: sales.length }
    for (const s of STATUSES) c[s] = 0
    for (const s of sales) c[s.status] = (c[s.status] || 0) + 1
    return c
  }, [sales])

  // Pendientes: cobro (saldo > 0) y entrega (no finalizada, por sub-estado).
  const kpis = useMemo(() => {
    const due = sales.filter(isDue)
    const dueTotal = due.reduce((a, s) => a + saldoDue(s), 0)
    const acopiado = sales.filter((s) => s.delivery_status === "Acopiado").length
    const agendado = sales.filter((s) => s.delivery_status === "Agendado").length
    const sinEstado = sales.filter((s) => !s.delivery_status).length
    const finalizadas = sales.filter((s) => s.delivery_status === "Finalizado").length
    return { dueCount: due.length, dueTotal, acopiado, agendado, sinEstado, finalizadas, pendEntrega: acopiado + agendado + sinEstado }
  }, [sales])

  const [openNew, setOpenNew] = useState(false)

  return (
    <>
      <TopbarActions>
        <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" />Agregar venta</Button>
      </TopbarActions>
      <div className="px-4 lg:px-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button onClick={() => setQuick(quick === "cobro" ? "none" : "cobro")} className={cn("text-left", quick === "cobro" && "ring-2 ring-foreground rounded-lg")}>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Pendiente de cobro</div>
              <div className="text-2xl font-semibold tabular">{fmtMoney(kpis.dueTotal)}</div>
              <div className="text-[11px] text-muted-foreground">{kpis.dueCount} ventas con saldo</div>
            </Card>
          </button>
          <button onClick={() => setQuick(quick === "entrega" ? "none" : "entrega")} className={cn("text-left", quick === "entrega" && "ring-2 ring-foreground rounded-lg")}>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Pendiente de entrega</div>
              <div className="text-2xl font-semibold tabular">{kpis.pendEntrega}</div>
              <div className="text-[11px] text-muted-foreground">{kpis.agendado} agendadas · {kpis.acopiado} acopiadas · {kpis.sinEstado} s/estado</div>
            </Card>
          </button>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Finalizadas</div>
            <div className="text-2xl font-semibold tabular">{kpis.finalizadas}</div>
            <div className="text-[11px] text-muted-foreground">de {sales.length} ventas</div>
          </Card>
        </div>
        {quick !== "none" ? (
          <div className="text-xs text-muted-foreground">Filtro activo: <b>{quick === "cobro" ? "pendientes de cobro" : "pendientes de entrega"}</b> · <button className="underline" onClick={() => setQuick("none")}>quitar</button></div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1">
            {(["Todas", ...STATUSES] as const).map((s) => (
              <Button key={s} size="sm" variant={s === filter ? "default" : "outline"} onClick={() => setFilter(s)} className="h-8 px-3 text-xs">
                {s} <span className="ml-1 text-muted-foreground">{counts[s] ?? 0}</span>
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setViewPersist(v as View)}>
              <TabsList className="h-8">
                <TabsTrigger value="tabla" className="gap-1.5"><Rows3 className="h-3.5 w-3.5" />Tabla</TabsTrigger>
                <TabsTrigger value="kanban" className="gap-1.5"><LayoutGrid className="h-3.5 w-3.5" />Kanban</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente o nº…" className="pl-8 h-8" />
            </div>
          </div>
        </div>
        {view === "tabla" ? (
          <Card className="overflow-hidden py-0"><VentasTable rows={filtered} /></Card>
        ) : (
          <VentasKanban rows={filtered} onChanged={refetchSales} />
        )}
      </div>
      <SaleForm open={openNew} onOpenChange={setOpenNew} />
    </>
  )
}

function VentasTable({ rows }: { rows: Sale[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Entrega</TableHead>
          <TableHead>Fecha</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Saldo</TableHead>
          <TableHead className="text-right">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const due = saldoDue(r)
          return (
            <TableRow key={r.id}>
              <TableCell className="text-muted-foreground tabular">#{r.quote_number}</TableCell>
              <TableCell><div className="truncate max-w-[280px]">{r.client_name}</div><div className="text-xs text-muted-foreground line-clamp-1">{r.description}</div></TableCell>
              <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
              <TableCell><DeliveryBadge value={r.delivery_status} /></TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleDateString("es-AR") : "—"}</TableCell>
              <TableCell className="text-right tabular">{fmtMoney(r.contract_total)}</TableCell>
              <TableCell className={`text-right tabular ${due > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>{fmtMoney(due)}</TableCell>
              <TableCell className="text-right"><SaleRowActions sale={r} /></TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function VentasKanban({ rows, onChanged }: { rows: Sale[]; onChanged: () => void }) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<SaleStatus | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const txn = useAction(api.saleTransition)
  const selected = selectedId ? rows.find(s => s.id === selectedId) ?? null : null

  const byStatus = useMemo(() => {
    const m: Record<string, Sale[]> = { Confirmado: [], Programado: [], "En proceso": [], Finalizado: [] }
    for (const r of rows) (m[r.status] ??= []).push(r)
    return m
  }, [rows])

  const handleDrop = async (status: SaleStatus, e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData("text/sale-id")
    setDragOver(null); setDraggingId(null)
    if (!id) return
    const sale = rows.find(s => s.id === id)
    if (!sale || sale.status === status) return
    // Programado requiere fecha de colocación: si no la tiene, abrir el detalle para cargarla.
    if (status === "Programado" && !sale.delivery_date) { setSelectedId(id); return }
    const r = await txn.run(id, status)
    if (r) onChanged()  // refetch suave, sin recargar la página
  }

  return (
    <TooltipProvider delayDuration={120}>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {STATUSES.map((status) => {
        const list = byStatus[status] ?? []
        const total = list.reduce((s, r) => s + (r.contract_total || 0), 0)
        const isTarget = dragOver === status
        const Icon = STATUS_ICON[status]
        const color = STATUS_COLOR[status]
        return (
          <div
            key={status}
            className={cn(
              "rounded-lg border flex flex-col transition-colors overflow-hidden",
              isTarget ? "border-primary bg-primary/5" : "border-border",
              !isTarget && color.tint
            )}
            onDragOver={(e) => { if (draggingId) { e.preventDefault(); setDragOver(status) } }}
            onDragLeave={() => setDragOver(prev => prev === status ? null : prev)}
            onDrop={(e) => handleDrop(status, e)}
          >
            <div className={cn("h-1 w-full", color.bar)} />
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wide flex items-center gap-2">
                {Icon ? <Icon className={cn("h-3.5 w-3.5", color.icon)} /> : <span className={cn("inline-block h-2 w-2 rounded-full", color.dot)} />}
                {status}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground transition-colors -m-1 p-1" aria-label={`Definición de ${status}`}>
                      <Info className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px] text-xs">{STATUS_INFO[status]}</TooltipContent>
                </Tooltip>
                <Badge variant="outline" className={cn("text-[10px]", color.badge)}>{list.length}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground tabular">{fmtMoney(total)}</div>
            </div>
            <div className="flex flex-col gap-2 p-2 min-h-[120px] max-h-[640px] overflow-y-auto">
              {list.length === 0 ? <div className="text-xs text-muted-foreground text-center py-6">Sin ventas</div> : list.map((r) => {
                const due = saldoDue(r)
                const isDragging = draggingId === r.id
                return (
                  <div
                    key={r.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/sale-id", r.id); e.dataTransfer.effectAllowed = "move"; setDraggingId(r.id) }}
                    onDragEnd={() => { setDraggingId(null); setDragOver(null) }}
                    onClick={() => setSelectedId(r.id)}
                    className={cn(
                      "bg-card border border-border rounded-md p-3 hover:bg-accent transition-colors cursor-pointer",
                      isDragging && "opacity-50 ring-2 ring-primary"
                    )}
                    title="Click para abrir · arrastrá para cambiar estado"
                  >
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <div className="text-sm font-medium truncate flex-1" title={r.title}>{r.title || r.client_name}</div>
                      <div onClick={(e) => e.stopPropagation()}><SaleRowActions sale={r} /></div>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{r.client_name}</div>
                    <div className="text-[10px] text-muted-foreground tabular mt-0.5">#{r.quote_number}</div>
                    {r.description ? <div className="text-xs text-muted-foreground line-clamp-2 mt-1.5">{r.description}</div> : null}
                    <div className="flex items-center justify-between text-xs">
                      <span className="tabular text-foreground">{fmtMoney(r.contract_total)}</span>
                      {due > 0 ? <Badge variant="outline" className="text-[10px]">Saldo {fmtMoney(due)}</Badge> : <span className="text-muted-foreground tabular">{r.created_at ? new Date(r.created_at).toLocaleDateString("es-AR") : "—"}</span>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <DeliveryBadge value={r.delivery_status} />
                      {isDue(r) ? <span className="text-[10px] text-foreground">· debe {fmtMoney(saldoDue(r))}</span> : null}
                    </div>
                    {r.delivery_date && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                        <CalendarDays className="h-2.5 w-2.5" />Entrega {new Date(r.delivery_date).toLocaleDateString("es-AR")}{r.delivery_date_to && r.delivery_date_to !== r.delivery_date ? ` → ${new Date(r.delivery_date_to).toLocaleDateString("es-AR")}` : ""}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
    <SaleDetailSheet sale={selected} onClose={() => setSelectedId(null)} onChanged={onChanged} />
    </TooltipProvider>
  )
}

// -----------------------------------------------------------------------------
// SaleDetailSheet — click card → full sale view with editable Entrega section
// -----------------------------------------------------------------------------
function SaleDetailSheet({ sale, onClose, onChanged }: { sale: Sale | null; onClose: () => void; onChanged: () => void }) {
  const settings = useApi<{ sellers?: { name: string }[]; crews?: string[] }>("/api/settings").data
  const crews = settings?.crews ?? []
  const quotes = useApi<Quote[]>("/api/quotes").data ?? []
  const cajas = useApi<Caja[]>("/api/cajas").data ?? []
  const cashflow = useApi<CashflowMovement[]>("/api/cashflow").data ?? []
  const products = useApi<Product[]>("/api/products").data ?? []
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [crew, setCrew] = useState("")
  const [notes, setNotes] = useState("")
  // Registrar cobro
  const [payAmount, setPayAmount] = useState<number>(0)
  const [payCaja, setPayCaja] = useState("")
  const [payDate, setPayDate] = useState("")
  // Preparación del remito (inspección)
  const [remitoItems, setRemitoItems] = useState<{ description: string; quantity: number; unit: string }[]>([])
  const [remitoConfirmed, setRemitoConfirmed] = useState(false)
  const [remitoSaved, setRemitoSaved] = useState(false)
  const update = useAction(api.update)
  const txn = useAction(api.saleTransition)
  const createTask = useAction(api.create)
  const createMov = useAction(api.create)

  useEffect(() => {
    if (!sale) return
    setDateFrom(sale.delivery_date ? sale.delivery_date.slice(0, 10) : "")
    setDateTo(sale.delivery_date_to ? sale.delivery_date_to.slice(0, 10) : "")
    setCrew(sale.delivery_crew ?? "")
    setNotes(sale.delivery_notes ?? "")
    setPayAmount(0)
    setPayCaja("")
    setPayDate(new Date().toISOString().slice(0, 10))
    setRemitoItems(sale.remito_items ?? [])
    setRemitoConfirmed(!!sale.remito_confirmed)
    setRemitoSaved(false)
  }, [sale?.id])

  if (!sale) return null

  const due = saldoDue(sale)
  const paid = cobrado(sale)
  const isFirstSchedule = !sale.delivery_date
  const linkedQuote = quotes.find(q => q.id === sale.quote_id) ?? null

  const saveEntrega = async () => {
    if (!dateFrom) return
    const effectiveTo = dateTo && dateTo >= dateFrom ? dateTo : ""
    await update.run("sales", sale.id, {
      delivery_date: dateFrom,
      delivery_date_to: effectiveTo || undefined,
      delivery_crew: crew || undefined,
      delivery_notes: notes || undefined,
    })
    // Conexión agenda → ventas: fecha futura → Programado; fecha de hoy/pasada → En proceso.
    const today = new Date().toISOString().slice(0, 10)
    if (dateFrom <= today) { if (sale.status === "Confirmado" || sale.status === "Programado") await txn.run(sale.id, "En proceso") }
    else if (sale.status === "Confirmado") await txn.run(sale.id, "Programado")
    if (isFirstSchedule) {
      const now = new Date().toISOString()
      const m = new Date(dateFrom); m.setDate(m.getDate() - 2)
      await createTask.run("tasks", {
        type: "medicion",
        title: `Medición previa · ${sale.client_name}`,
        due_date: m.toISOString().slice(0, 10),
        assigned_seller: crew || sale.seller_name || undefined,
        status: "pendiente",
        sale_id: sale.id,
        notes: sale.client_address || "",
        created_at: now,
      })
      // Remito is created automatically when the Medición is marked complete (see /agenda).
    }
    onClose(); onChanged()
  }

  const clearEntrega = async () => {
    if (!confirm("¿Limpiar la fecha de entrega? Las tareas de medición / informe ya creadas siguen en la agenda — moveles la fecha o cancelálas desde ahí.")) return
    await update.run("sales", sale.id, { delivery_date: "", delivery_date_to: "", delivery_crew: "", delivery_notes: "" })
    onClose(); onChanged()
  }

  // Cobros: ingresos del cashflow linkeados a esta venta (la misma fuente que usa el saldo).
  const cobros = cashflow.filter(m => m.flow === "Ingreso" && m.sale_ref === sale.quote_number)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
  const registrarCobro = async () => {
    if (payAmount <= 0 || !payCaja) return
    const caja = cajas.find(c => c.id === payCaja)
    await createMov.run("cashflow", {
      flow: "Ingreso", date: (payDate || new Date().toISOString().slice(0, 10)) + "T00:00:00.000Z",
      caja_id: payCaja, caja_name: caja?.name ?? "",
      category: "Venta - Pisos", subcategory: null,
      counterparty: sale.client_name, counterparty_type: "client",
      description: `Cobro - ${sale.title || sale.client_name}`, sale_ref: sale.quote_number,
      currency: "USD", amount_ars: null, amount_usd: Math.round(payAmount * 100) / 100, exchange_rate: null,
      fixed_variable: null, expense_type: null, transfer: false, needs_review: false, review_reason: null,
    })
    onClose(); onChanged()
  }

  // Preparación del remito (inspección): parte de los m² de piso y se agregan terminaciones.
  const FINISH_PRESETS = ["Varilla de terminación", "Cuartacaña", "Zócalo", "Perfil de transición", "Nariz de escalón", "Cinta doble faz", "Nylon / film", "Adhesivo"]
  const prefillRemito = () => {
    const isSvc = (it: any) => /^SERV/i.test(it.sku || "") || /colocaci|entrega|ajuste|medici|reparaci|servicio|mano de obra|flete/i.test(it.description || "")
    const mats = (sale.items || []).filter((it) => it.product_id !== "discount" && !/^descuento/i.test(it.description || "") && !isSvc(it))
    setRemitoItems(mats.map((it) => ({ description: it.description || it.sku || "", quantity: Number(it.quantity) || 0, unit: /z[oó]calo|varilla|cuartaca|nariz|moldura/i.test(it.description || "") ? "ml" : "m²" })))
    setRemitoSaved(false)
  }
  const addRemitoRow = (preset?: string) => { setRemitoItems((r) => [...r, { description: preset || "", quantity: 0, unit: preset && /varilla|cuartaca|z[oó]calo|nariz|perfil/i.test(preset) ? "ml" : "u" }]); setRemitoSaved(false) }
  const addRemitoProduct = (productId: string) => {
    const p = products.find((x) => x.id === productId); if (!p) return
    const unit = p.stockTrack ? "m²" : (/z[oó]calo|varilla|cuartaca|nariz|moldura|perfil/i.test(p.name) ? "ml" : "u")
    setRemitoItems((r) => [...r, { description: p.name, quantity: 0, unit }]); setRemitoSaved(false)
  }
  const updateRemitoRow = (i: number, patch: Partial<{ description: string; quantity: number; unit: string }>) => { setRemitoItems((r) => r.map((x, idx) => idx === i ? { ...x, ...patch } : x)); setRemitoSaved(false) }
  const removeRemitoRow = (i: number) => { setRemitoItems((r) => r.filter((_, idx) => idx !== i)); setRemitoSaved(false) }
  const saveRemito = async () => {
    const clean = remitoItems.filter((x) => x.description.trim())
    const r = await update.run("sales", sale.id, { remito_items: clean, remito_confirmed: remitoConfirmed })
    if (r) setRemitoSaved(true)
  }
  const remitoPickerItems = products.filter((p) => p.active !== false).map((p) => ({ id: p.id, label: p.name, sub: p.sku, keywords: p.category }))

  return (
    <Sheet open={!!sale} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="!max-w-2xl w-full overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between gap-3 pr-8">
            <div>
              <SheetTitle>{sale.client_name}</SheetTitle>
              <SheetDescription>
                #{sale.quote_number} · {sale.created_at ? new Date(sale.created_at).toLocaleDateString("es-AR") : "sin fecha"}
                {" · "}<Badge variant="outline" className="text-[10px]">{sale.status}</Badge>
                {" · "}<DeliveryBadge value={sale.delivery_status} />
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 grid grid-cols-3 gap-2 text-xs">
          <Tile label="Total" value={fmtMoney(sale.contract_total)} />
          <Tile label="Cobrado" value={fmtMoney(paid)} />
          <Tile label="Saldo" value={fmtMoney(due)} highlight={due > 0} />
        </div>

        {/* Entrega — primary section */}
        <div className="mt-6 rounded-lg border border-border">
          <div className="px-4 py-2 border-b border-border flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-medium">Entrega</div>
            {sale.delivery_date && (
              <Badge variant="muted" className="text-[10px] ml-auto">
                {sale.delivery_date_to && sale.delivery_date_to !== sale.delivery_date
                  ? `${new Date(sale.delivery_date).toLocaleDateString("es-AR")} → ${new Date(sale.delivery_date_to).toLocaleDateString("es-AR")}`
                  : `Programada · ${new Date(sale.delivery_date).toLocaleDateString("es-AR")}`}
              </Badge>
            )}
          </div>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1">Entrega desde</label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Hasta <span className="text-muted-foreground font-normal">(opcional)</span></label>
                <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground -mt-1">Para instalaciones de varios días dejá "hasta". Al guardar: se agrega a Agenda + crea la Medición previa (−2 días). El Remito se genera cuando la medición esté completa.</div>
            <div>
              <label className="text-xs font-medium block mb-1">Equipo de colocación</label>
              {crews.length > 0 ? (
                <select value={crew} onChange={(e) => setCrew(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="">— Sin asignar —</option>
                  {crews.map(c => <option key={c} value={c}>{c}</option>)}
                  {crew && !crews.includes(crew) && crew !== "Externo" && <option value={crew}>{crew}</option>}
                  <option value="Externo">Externo / otro</option>
                </select>
              ) : (
                <Input value={crew} onChange={(e) => setCrew(e.target.value)} placeholder="Equipo" />
              )}
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Notas de entrega</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ascensor de carga, llaves con portero…" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button onClick={saveEntrega} disabled={update.busy || txn.busy || createTask.busy || !dateFrom}>
                {update.busy || txn.busy || createTask.busy
                  ? "Guardando…"
                  : sale.delivery_date ? "Actualizar entrega" : "Programar entrega"}
              </Button>
              {sale.delivery_date && (
                <Button variant="outline" onClick={clearEntrega} disabled={update.busy}>Limpiar fecha</Button>
              )}
              <Button variant="outline" className="ml-auto" onClick={() => window.open(`/api/sales/${sale.id}/remito`, "_blank")}>
                <Truck className="h-4 w-4" />Remito depósito
              </Button>
            </div>
          </div>
        </div>

        {/* Cliente + items */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <DetailSection title="Cliente">
            <Row label="Nombre" value={sale.client_name} />
            {sale.client_dni && <Row label="DNI/CUIT" value={sale.client_dni} />}
            {sale.client_phone && <Row label="Teléfono" value={sale.client_phone} />}
            {sale.client_email && <Row label="Email" value={sale.client_email} />}
            {sale.client_address && <Row label="Dirección / obra" value={sale.client_address} />}
            {sale.seller_name && <Row label="Vendedor" value={sale.seller_name} />}
          </DetailSection>

          <DetailSection title={`Items (${sale.items?.length ?? 0})`}>
            <div className="space-y-1.5">
              {(sale.items ?? []).slice(0, 6).map((it, i) => (
                <div key={i} className="rounded-md border border-border px-2 py-1.5 flex items-center justify-between text-xs gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{it.description}</div>
                    <div className="text-[10px] text-muted-foreground">{it.sku} · {it.quantity} × {fmtMoney(it.unit_price)}</div>
                  </div>
                  <div className="tabular shrink-0">{fmtMoney(it.quantity * it.unit_price)}</div>
                </div>
              ))}
              {(sale.items?.length ?? 0) > 6 && <div className="text-[10px] text-muted-foreground text-center">…y {(sale.items?.length ?? 0) - 6} ítems más</div>}
            </div>
          </DetailSection>
        </div>

        <div className="mt-6">
          <DetailSection title="Cobros">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">Cobrado <b className="text-foreground tabular">{fmtMoney(paid)}</b> de {fmtMoney(sale.contract_total)}</span>
              <span className={cn("tabular font-medium", due > 0.5 ? "text-amber-700" : "text-emerald-700")}>{due > 0.5 ? `Saldo ${fmtMoney(due)}` : "Saldado ✓"}</span>
            </div>
            {due > 0.5 && (
              <div className="rounded-md border border-border p-2.5 space-y-2 bg-muted/20">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-0.5">Monto (US$)</div>
                    <div className="flex gap-1">
                      <Input type="number" min={0} step="0.01" value={payAmount === 0 ? "" : payAmount} placeholder="0" onChange={(e) => setPayAmount(Number(e.target.value) || 0)} className="h-8" />
                      <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs shrink-0" onClick={() => setPayAmount(Math.round(due * 100) / 100)}>Todo</Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-0.5">Fecha</div>
                    <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="h-8" />
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground mb-0.5">Caja</div>
                  <select value={payCaja} onChange={(e) => setPayCaja(e.target.value)} className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                    <option value="">— Elegí la caja —</option>
                    {cajas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <Button size="sm" onClick={registrarCobro} disabled={createMov.busy || payAmount <= 0 || !payCaja}>{createMov.busy ? "Registrando…" : "Registrar cobro"}</Button>
                {createMov.error && <div className="text-[11px] text-destructive">{createMov.error}</div>}
              </div>
            )}
            {cobros.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {cobros.map((m) => (
                  <div key={m.id} className="rounded-md border border-border px-2 py-1.5 flex items-center justify-between text-xs gap-2">
                    <span>{m.date ? new Date(m.date).toLocaleDateString("es-AR") : "—"}</span>
                    <span className="text-muted-foreground truncate">{m.caja_name}</span>
                    <span className="tabular">{fmtMoney(m.amount_usd || 0)}</span>
                  </div>
                ))}
              </div>
            )}
          </DetailSection>
        </div>

        <div className="mt-6">
          <DetailSection title={`Preparación del remito (inspección)${remitoConfirmed ? " ✓" : ""}`}>
            <p className="text-[11px] text-muted-foreground mb-2">Para el depósito: m² de piso + terminaciones (varillas, zócalos, cajas…) que define el inspector. Sin precios.</p>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1"><SearchPicker items={remitoPickerItems} placeholder="Buscar producto del inventario para agregar…" onPick={addRemitoProduct} /></div>
              {remitoItems.length === 0 && <Button size="sm" variant="outline" className="shrink-0" onClick={prefillRemito}>Cargar de la venta</Button>}
            </div>
            {remitoItems.length > 0 && (
              <div className="space-y-1.5">
                {remitoItems.map((it, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input value={it.description} onChange={(e) => updateRemitoRow(i, { description: e.target.value })} placeholder="Material" className="h-8 flex-1" />
                    <Input type="number" min={0} step="0.1" value={it.quantity === 0 ? "" : it.quantity} placeholder="0" onChange={(e) => updateRemitoRow(i, { quantity: Number(e.target.value) || 0 })} className="h-8 w-20" />
                    <select value={it.unit} onChange={(e) => updateRemitoRow(i, { unit: e.target.value })} className="h-8 rounded-md border border-input bg-transparent px-1 text-xs">
                      {["m²", "ml", "u", "cajas", "bolsas", "rollos"].map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground" onClick={() => removeRemitoRow(i)}>✕</Button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1 mt-2">
              {FINISH_PRESETS.map(p => <button key={p} type="button" onClick={() => addRemitoRow(p)} className="text-[10px] border border-input rounded-full px-2 py-0.5 text-muted-foreground hover:text-foreground hover:border-foreground">+ {p}</button>)}
              <button type="button" onClick={() => addRemitoRow()} className="text-[10px] border border-input rounded-full px-2 py-0.5 text-muted-foreground hover:text-foreground hover:border-foreground">+ Otro</button>
            </div>
            <label className="flex items-center gap-2 text-xs mt-3 cursor-pointer">
              <input type="checkbox" checked={remitoConfirmed} onChange={(e) => { setRemitoConfirmed(e.target.checked); setRemitoSaved(false) }} />
              Confirmado por inspección <span className="text-muted-foreground">(versión final para el depósito)</span>
            </label>
            <div className="flex items-center gap-2 mt-2">
              <Button size="sm" onClick={saveRemito} disabled={update.busy}>{update.busy ? "Guardando…" : remitoSaved ? "Guardado ✓" : "Guardar remito"}</Button>
              <Button size="sm" variant="outline" onClick={() => window.open(`/api/sales/${sale.id}/remito`, "_blank")}><Truck className="h-4 w-4" />Ver / imprimir remito</Button>
            </div>
          </DetailSection>
        </div>

        {linkedQuote && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cotización vinculada · #{linkedQuote.quote_number}</div>
              <Button size="sm" variant="outline" onClick={() => openPacificPdf("quotes", linkedQuote.id)}>Descargar PDF</Button>
            </div>
            <div className="border border-border rounded-md overflow-hidden">
              <iframe title="Presupuesto" src={`/api/quotes/${linkedQuote.id}/pdf`} style={{ width: "100%", height: 560, border: 0 }} />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-md border border-border p-2", highlight && "border-amber-400/60 bg-amber-50/40 dark:bg-amber-950/20")}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("tabular text-sm mt-0.5", highlight && "font-medium")}>{value}</div>
    </div>
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
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right truncate">{value}</span>
    </div>
  )
}
