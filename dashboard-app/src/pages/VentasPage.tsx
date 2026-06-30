import { useEffect, useMemo, useRef, useState } from "react"
import { Search, LayoutGrid, Rows3, Smartphone, Plus, Check, CalendarDays, Truck, Info, CalendarClock, ArrowUp, ArrowDown, ChevronsUpDown, MessageCircle, Pencil, Trash2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { findConvId } from "@/lib/chat"
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
import { DataState } from "@/components/ui/data-state"
import { useAuth } from "@/contexts/AuthContext"
import { useConfirm } from "@/components/ui/confirm"
import { api, useAction, refresh } from "@/lib/mutations"
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

type View = "tabla" | "cards" | "kanban"

// ENTREGA DE MATERIAL (¿salió el piso del depósito?) — eje INDEPENDIENTE de la colocación (esa es el
// `status`: Confirmado→Programado→En proceso→Finalizado + la fecha de colocación). Se deriva de las
// entregas registradas + señales heredadas de la planilla. "full"=todo entregado, "partial"=entregas
// parciales, "none"=nada todavía.
function materialState(s: Sale): "full" | "partial" | "none" {
  if (s.stock_deducted) return "full"                              // entregas completas o finalización descontaron todo
  if ((s.material_deliveries?.length ?? 0) > 0) return "partial"   // entregas parciales registradas
  // Legado (planilla, sin registro de entregas): "Acopiado"/"Finalizado" o venta finalizada = material entregado.
  if (s.status === "Finalizado" || s.delivery_status === "Acopiado" || s.delivery_status === "Finalizado") return "full"
  return "none"
}
const MATERIAL_LABEL: Record<string, string> = { full: "Entregado", partial: "Parcial", none: "Sin entregar" }
function MaterialBadge({ sale }: { sale: Sale }) {
  const st = materialState(sale)
  if (st === "none") return <span className="text-[10px] text-muted-foreground">Sin entregar</span>
  return <Badge variant="outline" className={cn("text-[10px] font-normal", st === "full" ? "text-muted-foreground" : "text-amber-700 border-amber-400/40")}>{MATERIAL_LABEL[st]}</Badge>
}
// Cobro/saldo: priorizar la conciliación del cashflow (ingresos linkeados a la venta);
// caer a financial_position si la venta todavía no tiene cobros en el cashflow.
const saldoDue = (s: Sale) => s.cashflow_balance_due ?? s.financial_position?.balance_due ?? 0
const cobrado = (s: Sale) => s.cashflow_paid ?? s.financial_position?.total_paid ?? 0
const isDue = (s: Sale) => saldoDue(s) > 0.5
const isPendingDelivery = (s: Sale) => s.status !== "Cancelado" && materialState(s) !== "full"

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
    return (saved === "tabla" || saved === "kanban" || saved === "cards") ? saved : "kanban"
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

  // Pendientes: cobro (saldo > 0) y material a entregar (eje independiente de la colocación).
  const kpis = useMemo(() => {
    const due = sales.filter(isDue)
    const dueTotal = due.reduce((a, s) => a + saldoDue(s), 0)
    const active = sales.filter((s) => s.status !== "Cancelado")
    const matPartial = active.filter((s) => materialState(s) === "partial").length
    const matNone = active.filter((s) => materialState(s) === "none").length
    const finalizadas = sales.filter((s) => s.status === "Finalizado").length   // colocadas / obra cerrada
    return { dueCount: due.length, dueTotal, matPartial, matNone, finalizadas, pendMaterial: matPartial + matNone }
  }, [sales])

  const [openNew, setOpenNew] = useState(false)

  return (
    <>
      <TopbarActions>
        <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" />Agregar venta</Button>
      </TopbarActions>
     <DataState loading={salesApi.loading} error={salesApi.error} hasData={sales.length > 0} onRetry={refetchSales}>
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
              <div className="text-xs text-muted-foreground">Material a entregar</div>
              <div className="text-2xl font-semibold tabular">{kpis.pendMaterial}</div>
              <div className="text-[11px] text-muted-foreground">{kpis.matNone} sin entregar · {kpis.matPartial} parcial</div>
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
                <TabsTrigger value="cards" className="gap-1.5"><Smartphone className="h-3.5 w-3.5" />Tarjetas</TabsTrigger>
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
          <Card className="overflow-hidden py-0"><VentasTable rows={filtered} onChanged={refetchSales} /></Card>
        ) : view === "cards" ? (
          <VentasCards rows={filtered} onChanged={refetchSales} />
        ) : (
          <VentasKanban rows={filtered} onChanged={refetchSales} />
        )}
      </div>
     </DataState>
      <SaleForm open={openNew} onOpenChange={setOpenNew} />
    </>
  )
}

type VSortKey = "quote_number" | "client_name" | "status" | "created_at" | "contract_total" | "saldo"
function VentasTable({ rows, onChanged }: { rows: Sale[]; onChanged: () => void }) {
  const [sortKey, setSortKey] = useState<VSortKey>("created_at")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = selectedId ? rows.find((s) => s.id === selectedId) ?? null : null
  const sortBy = (k: VSortKey) => { if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(k); setSortDir(k === "client_name" || k === "status" ? "asc" : "desc") } }
  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sortKey === "client_name") return (a.client_name || "").localeCompare(b.client_name || "") * dir
      if (sortKey === "status") return (a.status || "").localeCompare(b.status || "") * dir
      if (sortKey === "created_at") return (a.created_at || "").localeCompare(b.created_at || "") * dir
      if (sortKey === "quote_number") return String(a.quote_number || "").localeCompare(String(b.quote_number || ""), undefined, { numeric: true }) * dir
      if (sortKey === "contract_total") return ((a.contract_total || 0) - (b.contract_total || 0)) * dir
      if (sortKey === "saldo") return (saldoDue(a) - saldoDue(b)) * dir
      return 0
    })
  }, [rows, sortKey, sortDir])
  const SortH = ({ k, children, align }: { k: VSortKey; children: React.ReactNode; align?: "right" }) => {
    const Icon = sortKey !== k ? ChevronsUpDown : sortDir === "asc" ? ArrowUp : ArrowDown
    return (
      <TableHead className={cn(align === "right" && "text-right")}>
        <button onClick={() => sortBy(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", sortKey === k ? "text-foreground" : "text-muted-foreground")}>
          {align === "right" && <Icon className="h-3 w-3" />}{children}{align !== "right" && <Icon className="h-3 w-3" />}
        </button>
      </TableHead>
    )
  }
  return (
    <>
    <Table>
      <TableHeader>
        <TableRow>
          <SortH k="quote_number">#</SortH>
          <SortH k="client_name">Cliente</SortH>
          <SortH k="status">Estado</SortH>
          <TableHead>Material</TableHead>
          <SortH k="created_at">Fecha</SortH>
          <SortH k="contract_total" align="right">Total</SortH>
          <SortH k="saldo" align="right">Saldo</SortH>
          <TableHead className="text-right">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => {
          const due = saldoDue(r)
          return (
            <TableRow key={r.id} onClick={() => setSelectedId(r.id)} className="cursor-pointer">
              <TableCell className="text-muted-foreground tabular">#{r.quote_number}</TableCell>
              <TableCell><div className="truncate max-w-[280px]">{r.client_name}</div><div className="text-xs text-muted-foreground line-clamp-1">{r.description}</div></TableCell>
              <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
              <TableCell><MaterialBadge sale={r} /></TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleDateString("es-AR") : "—"}</TableCell>
              <TableCell className="text-right tabular">{fmtMoney(r.contract_total)}</TableCell>
              <TableCell className={`text-right tabular ${due > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>{fmtMoney(due)}</TableCell>
              <TableCell className="text-right"><div onClick={(e) => e.stopPropagation()}><SaleRowActions sale={r} /></div></TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
    <SaleDetailSheet sale={selected} onClose={() => setSelectedId(null)} onChanged={onChanged} />
    </>
  )
}

// Vista simple en tarjetas (cómoda en móvil). Tap → abre el detalle de la venta.
function VentasCards({ rows, onChanged }: { rows: Sale[]; onChanged: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = selectedId ? rows.find((s) => s.id === selectedId) ?? null : null
  return (
    <>
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground col-span-full text-center py-10">Sin ventas</div>
      ) : rows.map((s) => {
        const due = saldoDue(s)
        return (
          <div key={s.id} onClick={() => setSelectedId(s.id)} className="rounded-lg border border-border bg-card p-3 hover:bg-accent transition-colors cursor-pointer" title="Ver detalle">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium truncate">{s.client_name}</div>
                <div className="text-[10px] text-muted-foreground tabular">#{s.quote_number}{s.created_at ? ` · ${new Date(s.created_at).toLocaleDateString("es-AR")}` : ""}</div>
              </div>
              <div onClick={(e) => e.stopPropagation()}><SaleRowActions sale={s} /></div>
            </div>
            {(s.title || s.description) ? <div className="text-xs text-muted-foreground line-clamp-1 mt-1">{s.title || s.description}</div> : null}
            <div className="flex items-center justify-between gap-2 mt-2">
              <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
              <MaterialBadge sale={s} />
            </div>
            <div className="flex items-center justify-between mt-2 text-sm">
              <span className="tabular font-medium">{fmtMoney(s.contract_total)}</span>
              {due > 0.5 ? <Badge variant="outline" className="text-[10px]">Saldo {fmtMoney(due)}</Badge> : <span className="text-[11px] text-emerald-700">Saldado ✓</span>}
            </div>
            {s.delivery_date ? (
              <div className="text-[10px] text-muted-foreground mt-1.5 inline-flex items-center gap-1">
                <CalendarDays className="h-2.5 w-2.5" />Colocación {new Date(s.delivery_date).toLocaleDateString("es-AR")}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
    <SaleDetailSheet sale={selected} onClose={() => setSelectedId(null)} onChanged={onChanged} />
    </>
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
                      <MaterialBadge sale={r} />
                      {isDue(r) ? <span className="text-[10px] text-foreground">· debe {fmtMoney(saldoDue(r))}</span> : null}
                    </div>
                    {r.delivery_date && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                        <CalendarDays className="h-2.5 w-2.5" />Colocación {new Date(r.delivery_date).toLocaleDateString("es-AR")}{r.delivery_date_to && r.delivery_date_to !== r.delivery_date ? ` → ${new Date(r.delivery_date_to).toLocaleDateString("es-AR")}` : ""}
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
  const { state: authState } = useAuth()
  const isAdmin = authState.user?.role === "admin"
  const [editOpen, setEditOpen] = useState(false)
  const [deliverOpen, setDeliverOpen] = useState(false)
  const update = useAction(api.update)
  const txn = useAction(api.saleTransition)
  const createTask = useAction(api.create)
  const createMov = useAction(api.create)
  const conversations = useApi<any[]>("/api/conversations").data ?? []
  const navigate = useNavigate()
  const openChat = () => {
    if (!sale) return
    const id = findConvId(conversations, { phone: sale.client_phone, email: sale.client_email, name: sale.client_name })
    navigate(id ? `/mensajes?conv=${id}` : "/mensajes")
  }

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
    <>
    <Sheet open={!!sale} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="!max-w-2xl w-full overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between gap-3 pr-8">
            <div>
              <SheetTitle>{sale.client_name}</SheetTitle>
              <SheetDescription>
                #{sale.quote_number} · {sale.created_at ? new Date(sale.created_at).toLocaleDateString("es-AR") : "sin fecha"}
                {" · "}<Badge variant="outline" className="text-[10px]">{sale.status}</Badge>
                {" · "}<MaterialBadge sale={sale} />
              </SheetDescription>
            </div>
            <Button variant="outline" size="sm" onClick={openChat}><MessageCircle className="h-4 w-4" />Chat</Button>
          </div>
        </SheetHeader>

        <div className="mt-6 grid grid-cols-3 gap-2 text-xs">
          <Tile label="Total" value={fmtMoney(sale.contract_total)} />
          <Tile label="Cobrado" value={fmtMoney(paid)} />
          <Tile label="Saldo" value={fmtMoney(due)} highlight={due > 0} />
        </div>

        <IvaEditor sale={sale} onChanged={onChanged} />

        {/* Entrega de material — descuenta stock SIN finalizar la venta (entrega antes de colocar) */}
        <MaterialDeliveryPanel sale={sale} products={products} isAdmin={isAdmin} onOpen={() => setDeliverOpen(true)} onChanged={onChanged} />

        {/* Colocación — agenda + equipo + medición/remito (no toca stock) */}
        <div className="mt-6 rounded-lg border border-border">
          <div className="px-4 py-2 border-b border-border flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-medium">Colocación</div>
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
                <label className="text-xs font-medium block mb-1">Colocación desde</label>
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
            {isAdmin && (
              sale.status === "Finalizado" || sale.status === "Cancelado"
                ? <div className="text-[10px] text-muted-foreground mt-2">No se puede editar: la venta ya está {sale.status === "Finalizado" ? "entregada" : "cancelada"}.</div>
                : <Button variant="outline" size="sm" className="mt-2 h-7 w-full" onClick={() => setEditOpen(true)}><Pencil className="h-3.5 w-3.5" />Editar ítems</Button>
            )}
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
    <EditSaleItemsSheet sale={sale} products={products} open={editOpen} onOpenChange={setEditOpen} onChanged={onChanged} />
    <DeliverMaterialSheet sale={sale} products={products} open={deliverOpen} onOpenChange={setDeliverOpen} onChanged={onChanged} />
    </>
  )
}

// Suma de m² ya entregados por SKU (desde el log de entregas de material de la venta).
function deliveredBySku(sale: Sale): Record<string, number> {
  const m: Record<string, number> = {}
  for (const d of sale.material_deliveries ?? [])
    for (const it of d.items ?? []) if (it.sku) m[it.sku] = (m[it.sku] ?? 0) + (Number(it.quantity) || 0)
  return m
}
// Ítems de la venta que llevan stock (pisos): ordenado / entregado / pendiente.
function materialLines(sale: Sale, products: Product[]) {
  const delivered = deliveredBySku(sale)
  const bySku = new Map(products.map((p) => [p.sku, p]))
  return (sale.items ?? [])
    .filter((it) => it.sku && bySku.get(it.sku)?.stockTrack)
    .map((it) => {
      const ordered = Number(it.quantity) || 0
      const deliv = delivered[it.sku] ?? 0
      return { sku: it.sku, description: it.description || it.sku, ordered, delivered: deliv, pending: Math.max(0, Math.round((ordered - deliv) * 100) / 100) }
    })
}

// Panel resumen de entrega de material en el detalle de la venta.
function MaterialDeliveryPanel({ sale, products, isAdmin, onOpen, onChanged }: { sale: Sale; products: Product[]; isAdmin: boolean; onOpen: () => void; onChanged: () => void }) {
  const confirm = useConfirm()
  const undo = useAction(api.undoMaterialDelivery)
  const lines = materialLines(sale, products)
  if (lines.length === 0) return null   // venta sin pisos (solo servicios/extras) → no aplica
  const totalOrdered = lines.reduce((a, l) => a + l.ordered, 0)
  const totalDelivered = lines.reduce((a, l) => a + l.delivered, 0)
  const totalPending = lines.reduce((a, l) => a + l.pending, 0)
  const deliveries = sale.material_deliveries ?? []
  const closed = sale.status === "Cancelado"
  const fmtM2 = (n: number) => `${Math.round(n * 100) / 100} m²`
  const undoLast = async () => {
    const ok = await confirm({ title: "Deshacer última entrega", description: "Devuelve al depósito el material de la última entrega registrada. Esta acción no se puede deshacer.", confirmLabel: "Deshacer", destructive: true })
    if (!ok) return
    const r = await undo.run(sale.id)
    if (r) onChanged()
  }
  return (
    <div className="mt-6 rounded-lg border border-border">
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <Truck className="h-4 w-4 text-muted-foreground" />
        <div className="text-sm font-medium">Entrega de material</div>
        <Badge variant={totalPending <= 0.01 ? "muted" : "outline"} className="text-[10px] ml-auto">
          {totalDelivered <= 0.01 ? "Sin entregar" : totalPending <= 0.01 ? "Entregado ✓" : `${fmtM2(totalDelivered)} de ${fmtM2(totalOrdered)}`}
        </Badge>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-[11px] text-muted-foreground -mt-1">Descuenta el stock cuando el piso sale del depósito, aunque la venta no esté finalizada (la colocación puede ser después). Soporta entregas parciales.</p>
        {totalDelivered > 0.01 && (
          <div className="space-y-1.5">
            {lines.map((l) => (
              <div key={l.sku} className="flex items-center justify-between text-xs gap-2">
                <span className="truncate text-muted-foreground">{l.description}</span>
                <span className="tabular shrink-0">{fmtM2(l.delivered)}<span className="text-muted-foreground"> / {fmtM2(l.ordered)}</span>{l.pending > 0.01 && <span className="text-amber-700"> · faltan {fmtM2(l.pending)}</span>}</span>
              </div>
            ))}
          </div>
        )}
        {deliveries.length > 0 && (
          <div className="space-y-1 border-t border-border pt-2">
            {deliveries.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-[11px] text-muted-foreground gap-2">
                <span>{d.date ? new Date(d.date).toLocaleDateString("es-AR") : "—"}{d.note ? ` · ${d.note}` : ""}</span>
                <span className="tabular shrink-0">{fmtM2(d.items.reduce((a, it) => a + (Number(it.quantity) || 0), 0))}</span>
              </div>
            ))}
          </div>
        )}
        {isAdmin && !closed && (
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={onOpen} disabled={totalPending <= 0.01}>
              <Truck className="h-4 w-4" />{totalPending <= 0.01 ? "Todo entregado" : totalDelivered > 0.01 ? "Entregar el resto" : "Entregar material"}
            </Button>
            {deliveries.length > 0 && <Button size="sm" variant="outline" onClick={undoLast} disabled={undo.busy}>{undo.busy ? "…" : "Deshacer última"}</Button>}
          </div>
        )}
        {!isAdmin && <p className="text-[10px] text-muted-foreground">Solo un administrador puede registrar entregas de material.</p>}
      </div>
    </div>
  )
}

// Form de entrega de material (parcial): por defecto entrega todo lo pendiente; el usuario puede ajustar cantidades.
function DeliverMaterialSheet({ sale, products, open, onOpenChange, onChanged }: { sale: Sale | null; products: Product[]; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const deliver = useAction(api.deliverMaterial)
  const [date, setDate] = useState("")
  const [note, setNote] = useState("")
  const [qty, setQty] = useState<Record<string, number>>({})
  const lines = useMemo(() => (sale ? materialLines(sale, products).filter((l) => l.pending > 0.01) : []), [sale, products])
  useEffect(() => {
    if (!open || !sale) return
    setDate(new Date().toISOString().slice(0, 10))
    setNote("")
    setQty(Object.fromEntries(materialLines(sale, products).filter((l) => l.pending > 0.01).map((l) => [l.sku, l.pending])))   // default: todo lo pendiente
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sale?.id])
  const submit = async () => {
    if (!sale) return
    const items = lines.map((l) => ({ sku: l.sku, quantity: Math.min(l.pending, Math.max(0, Number(qty[l.sku]) || 0)) })).filter((x) => x.quantity > 0)
    if (!items.length) return
    const r = await deliver.run(sale.id, { items, date: date || undefined, note: note || undefined })
    if (r) { onOpenChange(false); onChanged() }
  }
  const totalToDeliver = lines.reduce((a, l) => a + Math.min(l.pending, Math.max(0, Number(qty[l.sku]) || 0)), 0)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="!max-w-lg w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Entregar material</SheetTitle>
          <SheetDescription>{sale ? `#${sale.quote_number} · ${sale.client_name}` : ""} — descuenta del stock. La venta sigue abierta hasta la colocación.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1">Fecha de entrega</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Nota <span className="text-muted-foreground font-normal">(opcional)</span></label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Remito 0012, chofer…" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium">Material a entregar (m²)</div>
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay material pendiente de entregar.</p>
            ) : lines.map((l) => (
              <div key={l.sku} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{l.description}</div>
                  <div className="text-[10px] text-muted-foreground">{l.sku} · pendiente {Math.round(l.pending * 100) / 100} m²{l.delivered > 0.01 ? ` · ya entregado ${Math.round(l.delivered * 100) / 100}` : ""}</div>
                </div>
                <Input type="number" min={0} max={l.pending} step="0.01" value={qty[l.sku] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [l.sku]: Number(e.target.value) || 0 }))} className="h-9 w-24 shrink-0" />
              </div>
            ))}
          </div>
          {deliver.error && <div className="text-[11px] text-destructive">{deliver.error}</div>}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Button onClick={submit} disabled={deliver.busy || totalToDeliver <= 0.01}>{deliver.busy ? "Entregando…" : `Entregar ${Math.round(totalToDeliver * 100) / 100} m²`}</Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// Editar ítems de una venta no entregada: cambiar cantidades/precios, quitar o agregar
// ítems. Recalcula el total con la misma fórmula del sistema (neto − desc + IVA del modo).
function EditSaleItemsSheet({ sale, products, open, onOpenChange, onChanged }: { sale: Sale | null; products: Product[]; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const confirm = useConfirm()
  const save = useAction(api.saleEditItems)
  const [items, setItems] = useState<any[]>([])
  useEffect(() => { if (open && sale) setItems((sale.items ?? []).map((it) => ({ ...it }))) }, [open, sale])
  if (!sale) return null

  const isDiscountRow = (it: any) => it.product_id === "discount" || /^descuento/i.test(it.description || "")
  const itemGross = (it: any) => (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
  const itemDisc = (it: any) => {
    const g = itemGross(it)
    if (!it.disc_value || it.disc_value <= 0) return 0
    const amt = it.disc_kind === "amount" ? Number(it.disc_value) : g * Number(it.disc_value) / 100
    return Math.min(g, Math.round(amt * 100) / 100)
  }
  const real = items.filter((it) => !isDiscountRow(it))
  const subtotal = real.reduce((s, it) => s + itemGross(it), 0)
  // Mismo criterio que el backend: descuentos por ítem si los hay, si no preservar el de la venta.
  const anyItemDisc = items.some((it) => Number(it.disc_value) > 0)
  const discount = anyItemDisc ? real.reduce((s, it) => s + itemDisc(it), 0) : (Number(sale.discount_total) || 0)
  const net = Math.max(0, subtotal - discount)
  // IVA derivado del total original (preserva el tratamiento real, robusto a flags inconsistentes).
  let total: number, iva: number
  if (sale.iva_mode === "fixed") { iva = Number(sale.iva_amount) || 0; total = Math.round(net + iva) }
  else {
    const origReal = (sale.items ?? []).filter((it) => !isDiscountRow(it))
    const origGross = origReal.reduce((s, it) => s + (Number(it.total) || 0), 0)
    const origNet = Math.max(0, origGross - discount)
    const origTotal = Number(sale.contract_total) || origNet
    const factor = origNet > 0 ? origTotal / origNet : 1
    total = Math.round(net * factor)
    iva = total - net
  }
  const paid = sale.financial_position?.total_paid ?? 0
  const newBalance = Math.max(0, total - paid)

  const setQty = (i: number, v: number) => setItems(items.map((it, idx) => idx === i ? { ...it, quantity: v } : it))
  const setPrice = (i: number, v: number) => setItems(items.map((it, idx) => idx === i ? { ...it, unit_price: v } : it))
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i))
  const addProduct = (pid: string) => {
    const p = products.find((x) => x.id === pid); if (!p) return
    setItems([...items, { product_id: p.id, sku: p.sku, description: p.name, quantity: 1, unit_price: p.price, total: p.price, cost: p.cost, category: p.category }])
  }

  async function submit() {
    if (!real.length) return
    if (total < paid) {
      const ok = await confirm({ title: "El total queda por debajo de lo cobrado", description: `El nuevo total (${fmtMoney(total)}) es menor que lo ya cobrado (${fmtMoney(paid)}). Quedaría saldo a favor del cliente. ¿Continuar?`, confirmLabel: "Sí, guardar", destructive: true })
      if (!ok) return
    }
    const r = await save.run(sale!.id, items)
    if (r) { onChanged(); refresh(); onOpenChange(false) }
  }

  const pickerItems = products.filter((p) => p.active !== false).map((p) => ({ id: p.id, label: p.name, sub: p.sku, keywords: p.category, hint: fmtMoney(p.price) }))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="!max-w-xl w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Editar ítems · {sale.client_name}</SheetTitle>
          <SheetDescription>#{sale.quote_number} · {sale.status}. Cambiá cantidades/precios o quitá ítems; el total y el saldo se recalculan.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {items.map((it, i) => isDiscountRow(it) ? null : (
            <div key={i} className="rounded-md border border-border p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium truncate">{it.description}</div>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={() => removeItem(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
              <div className="flex items-end gap-2">
                <label className="text-[10px] text-muted-foreground flex-1">Cantidad (m²)
                  <Input type="number" min={0} step="0.01" value={it.quantity === 0 ? "" : it.quantity} onChange={(e) => setQty(i, Number(e.target.value) || 0)} className="h-8 mt-0.5" />
                </label>
                <label className="text-[10px] text-muted-foreground flex-1">Precio unit. (US$)
                  <Input type="number" min={0} step="0.01" value={it.unit_price === 0 ? "" : it.unit_price} onChange={(e) => setPrice(i, Number(e.target.value) || 0)} className="h-8 mt-0.5" />
                </label>
                <div className="text-sm tabular shrink-0 pb-1.5 w-24 text-right">{fmtMoney(itemGross(it))}</div>
              </div>
            </div>
          ))}
          <div className="pt-1">
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Agregar producto</div>
            <SearchPicker items={pickerItems} placeholder="Buscar producto…" onPick={addProduct} />
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-border p-3 text-sm space-y-1 tabular">
          <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{fmtMoney(subtotal)}</span></div>
          {discount > 0 && <div className="flex justify-between text-muted-foreground"><span>Descuentos</span><span>-{fmtMoney(discount)}</span></div>}
          <div className="flex justify-between text-muted-foreground"><span>IVA{iva <= 0 ? " (sin IVA)" : ""}</span><span>{fmtMoney(iva)}</span></div>
          <div className="flex justify-between font-semibold border-t border-border pt-1"><span>Total</span><span>{fmtMoney(total)}</span></div>
          <div className="flex justify-between text-xs pt-1"><span className="text-muted-foreground">Antes: {fmtMoney(sale.contract_total)}</span><span className={cn(newBalance > 0.5 ? "text-amber-700" : "text-emerald-700")}>Nuevo saldo {fmtMoney(newBalance)}</span></div>
        </div>
        {save.error && <div className="text-xs text-destructive mt-2">{save.error}</div>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button size="sm" onClick={submit} disabled={save.busy || !real.length}>{save.busy ? "Guardando…" : "Guardar cambios"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// Editor de IVA de la venta: sin IVA / IVA 21% / monto fijo (parcial). Recalcula el total.
function IvaEditor({ sale, onChanged }: { sale: Sale; onChanged: () => void }) {
  const upd = useAction(api.update)
  const net = useMemo(() => {
    const items = (sale.items || []).filter((it: any) => it.product_id !== "discount" && !/^descuento/i.test(it.description || ""))
    const gross = items.reduce((s: number, it: any) => s + (Number(it.total) || 0), 0)
    return Math.max(0, gross - (Number(sale.discount_total) || 0))
  }, [sale])
  const initMode: "none" | "full" | "fixed" = sale.iva_mode ?? (sale.has_iva ? "full" : "none")
  const [mode, setMode] = useState<"none" | "full" | "fixed">(initMode)
  const [fixed, setFixed] = useState<number>(sale.iva_amount ?? 0)
  const iva = mode === "none" ? 0 : mode === "full" ? Math.round(net * 0.21) : (Number(fixed) || 0)
  const total = Math.round(net + iva)
  const dirty = mode !== initMode || (mode === "fixed" && iva !== (sale.iva_amount ?? 0)) || total !== Math.round(sale.contract_total || 0)
  const save = async () => {
    const r = await upd.run("sales", sale.id, { iva_mode: mode, iva_amount: iva, has_iva: mode !== "none", contract_total: total })
    if (r) onChanged()
  }
  const Opt = ({ m, label }: { m: "none" | "full" | "fixed"; label: string }) => (
    <button type="button" onClick={() => setMode(m)} className={cn("px-2.5 h-8 rounded-md border text-xs", mode === m ? "border-foreground bg-foreground text-background" : "border-border")}>{label}</button>
  )
  return (
    <div className="mt-3 rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium mr-1">IVA</span>
        <Opt m="none" label="Sin IVA" /><Opt m="full" label="IVA 21%" /><Opt m="fixed" label="Monto fijo" />
        {mode === "fixed" && (
          <Input type="number" min={0} value={fixed || ""} onChange={(e) => setFixed(Number(e.target.value))} placeholder="IVA $" className="h-8 w-28" />
        )}
        <Button size="sm" className="ml-auto" onClick={save} disabled={!dirty || upd.busy}>{upd.busy ? "Guardando…" : "Aplicar"}</Button>
      </div>
      <div className="text-[11px] text-muted-foreground tabular">
        Neto {fmtMoney(net)} · IVA {fmtMoney(iva)} · <b>Total {fmtMoney(total)}</b>
      </div>
      {upd.error && <div className="text-[11px] text-destructive">{upd.error}</div>}
    </div>
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
