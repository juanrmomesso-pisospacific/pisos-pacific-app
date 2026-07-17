import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Ship, Plus, GripVertical, ChevronDown, Truck } from "lucide-react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { useNavigate } from "react-router-dom"
import { saleMaterialsForRemito, looseUnit } from "@/lib/remito"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { fmtMoney, cn, appLocale } from "@/lib/utils"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import type { Sale, Container, Product } from "@/lib/types"
import { type Task, type TaskType, TASK_TYPE_LABEL, TASK_TYPE_ORDER } from "@/lib/tasks"
import { ContainerImportForm } from "@/components/forms/ContainerImportForm"
import { ContainerDetailSheet } from "@/components/forms/ContainerDetailSheet"
import { SearchPicker } from "@/components/SearchPicker"
import {
  WEEKDAYS, CREW_FALLBACK, crewColor, crewInitials, EVENT_COLORS, ESTADO_COLOR, MATERIAL_COLOR, MATERIAL_LABEL,
  tint, startOfMonth, addMonths, addDays, dayKey, startOfWeek, weekDays, daysGrid, isToday,
  saleToPlacement, deriveDesigns, designsInSales, materialState,
} from "@/lib/calendar"

// ---------------------------------------------------------------------------
// Modelo de evento unificado del calendario. Una OBRA = venta con delivery_date.
// Reparación / Ausencia = tasks (ocupan a un equipo). Medición/Remito/Container = puntuales.
// ---------------------------------------------------------------------------
type EventKind = "obra" | "container" | "medicion" | "remito" | "visita" | "seguimiento" | "reparacion" | "ausencia" | "todo" | "otro"
type CalEvent = {
  id: string
  kind: EventKind
  date: string          // inicio YYYY-MM-DD
  endDate: string       // fin (= date si es de un día)
  ts: number
  title: string
  crew?: string | null
  sale?: Sale
  task?: Task
  containerId?: string
  estado?: string
  designs?: { design: string; m2: number }[]
  totalM2?: number
  material?: "full" | "partial" | "none"
  address?: string
  detalle?: string
  meta?: string
}
type Scope = "mes" | "esta" | "proxima"
type Lens = "calendario" | "equipos" | "lista"
type Filters = { colocador: string | null; diseno: string | null; estado: string | null }

const ESTADOS = ["Confirmado", "Programado", "En proceso", "Finalizado"]
const saleLabel = (s: Sale) => `${s.title || s.client_name} · ${s.client_name} · #${s.quote_number}`

function taskKindToEventKind(t: TaskType): EventKind {
  switch (t) {
    case "medicion": return "medicion"
    case "remito": return "remito"
    case "entrega": return "obra"
    case "visita": return "visita"
    case "seguimiento": return "seguimiento"
    case "reparacion": return "reparacion"
    case "ausencia": return "ausencia"
    case "todo": return "todo"
    default: return "otro"
  }
}
// Color de identidad del evento: obra → color del equipo; el resto → color por tipo.
function eventColor(e: CalEvent): string {
  if (e.kind === "obra") return crewColor(e.crew)
  return EVENT_COLORS[e.kind] ?? EVENT_COLORS.obra
}
const KIND_LABEL: Record<EventKind, string> = {
  obra: "Obra", container: "Container", medicion: "Medición", remito: "Remito",
  visita: "Visita", seguimiento: "Seguimiento", reparacion: "Reparación", ausencia: "Ausencia", todo: "Tarea", otro: "Otro",
}

// ---- badges reutilizables ----
function EstadoBadge({ estado }: { estado?: string }) {
  if (!estado) return null
  const c = ESTADO_COLOR[estado] ?? "#7A746C"
  return <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide" style={{ background: tint(c, 0.16), color: c }}>{estado}</span>
}
function MaterialDot({ state, showLabel }: { state?: "full" | "partial" | "none"; showLabel?: boolean }) {
  if (!state) return null
  const c = MATERIAL_COLOR[state]
  return <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: c }}><span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />{showLabel && MATERIAL_LABEL[state]}</span>
}
function CrewAvatar({ crew, size = 24 }: { crew?: string | null; size?: number }) {
  const c = crewColor(crew)
  return <span className="inline-flex items-center justify-center rounded-full text-white font-medium shrink-0" style={{ background: c, width: size, height: size, fontSize: size * 0.42 }}>{crewInitials(crew)}</span>
}

// ===========================================================================
export default function AgendaPage() {
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const containers = useApi<Container[]>("/api/containers").data ?? []
  const tasks = useApi<Task[]>("/api/tasks").data ?? []
  const products = useApi<Product[]>("/api/products").data ?? []
  const settings = useApi<{ crews?: string[] }>("/api/settings").data
  const crews = settings?.crews ?? []

  const [scope, setScope] = useState<Scope>("mes")
  const [lens, setLens] = useState<Lens>("calendario")
  const [filters, setFilters] = useState<Filters>({ colocador: null, diseno: null, estado: null })
  const [newOpen, setNewOpen] = useState(false)
  const [presetSaleId, setPresetSaleId] = useState<string | null>(null)
  const [containerImportOpen, setContainerImportOpen] = useState(false)
  // Sheets centralizados (los disparan todas las vistas + el modal)
  const [modalSaleId, setModalSaleId] = useState<string | null>(null)
  const [detailContainerId, setDetailContainerId] = useState<string | null>(null)
  const [medicionTask, setMedicionTask] = useState<Task | null>(null)
  const [informeTask, setInformeTask] = useState<Task | null>(null)

  const activeView: "mes" | "semana" | "equipos" | "lista" =
    lens === "equipos" ? "equipos" : lens === "lista" ? "lista" : scope === "mes" ? "mes" : "semana"

  const events = useMemo<CalEvent[]>(() => {
    const out: CalEvent[] = []
    for (const s of sales) {
      if (s.status === "Cancelado") continue
      const p = saleToPlacement(s); if (!p) continue
      const designs = deriveDesigns(s.items, products)
      out.push({
        id: "obra-" + s.id, kind: "obra", date: p.startStr, endDate: p.endStr, ts: +p.start,
        title: s.title || s.client_name, crew: s.delivery_crew, sale: s, estado: s.status,
        designs, totalM2: designs.reduce((a, d) => a + d.m2, 0), material: materialState(s),
        address: s.client_address, meta: p.totalDays > 1 ? `${p.totalDays} días` : "",
      })
    }
    for (const c of containers) {
      if (c.status === "received" || !c.eta) continue
      const items = Array.isArray(c.items) ? c.items : []
      const d = c.eta.slice(0, 10)
      out.push({ id: "cont-" + c.id, kind: "container", date: d, endDate: d, ts: +new Date(c.eta), title: `${c.id} · ${c.vessel}`, containerId: c.id, detalle: `${c.supplier} · ${items.length} SKUs`, meta: items.reduce((s, i) => s + (Number(i.quantity) || 0), 0).toLocaleString(appLocale()) + " m²" })
    }
    for (const t of tasks) {
      if (t.status === "cancelada") continue
      const kind = taskKindToEventKind(t.type)
      const d = t.due_date.slice(0, 10)
      const end = t.due_date_to && t.due_date_to.slice(0, 10) >= d ? t.due_date_to.slice(0, 10) : d
      out.push({ id: "task-" + t.id, kind, date: d, endDate: end, ts: +new Date(t.due_date), title: t.title, crew: t.assigned_seller, task: t, detalle: t.notes || "" })
    }
    return out.sort((a, b) => a.ts - b.ts)
  }, [sales, containers, tasks, products])
  // Eventos que van al CALENDARIO (Mes/Semana): todo menos las tareas del bot (esas solo en Lista).
  const calendarEvents = useMemo(() => events.filter(e => e.kind !== "todo"), [events])

  // Opciones de filtro
  const disenoOptions = useMemo(() => designsInSales(sales.filter(s => s.delivery_date && s.status !== "Cancelado"), products), [sales, products])
  const colocadorOptions = useMemo(() => {
    const set = new Set<string>(crews)
    for (const e of events) if ((e.kind === "obra" || e.kind === "reparacion" || e.kind === "ausencia") && e.crew) set.add(e.crew)
    return [...set]
  }, [crews, events])

  const matches = (e: CalEvent) => {
    if (filters.colocador && e.crew !== filters.colocador) return false
    if (filters.diseno && !(e.kind === "obra" && e.designs?.some(d => d.design === filters.diseno))) return false
    if (filters.estado && !(e.kind === "obra" && e.estado === filters.estado)) return false
    return true
  }
  const anyFilter = !!(filters.colocador || filters.diseno || filters.estado)
  const countFor = (pred: (e: CalEvent) => boolean) => events.filter(pred).length

  const openObra = (saleId?: string) => saleId && setModalSaleId(saleId)
  const reprogramar = (saleId: string) => { setModalSaleId(null); setPresetSaleId(saleId); setNewOpen(true) }
  const openMedicionForSale = (saleId: string) => { const t = tasks.find(x => x.type === "medicion" && x.sale_id === saleId && x.status !== "cancelada"); if (t) setMedicionTask(t) }
  const openRemitoForSale = (saleId: string) => { const t = tasks.find(x => x.type === "remito" && x.sale_id === saleId && x.status !== "cancelada"); if (t) setInformeTask(t) }

  const modalSale = modalSaleId ? sales.find(s => s.id === modalSaleId) ?? null : null
  const detailContainer = detailContainerId ? containers.find(c => c.id === detailContainerId) ?? null : null

  return (
    <>
      <TopbarActions>
        {/* Control temporal primario */}
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {(["mes", "esta", "proxima"] as Scope[]).map(s => (
            <button key={s} onClick={() => { setScope(s); setLens("calendario") }}
              className={cn("h-7 rounded-md px-2.5 text-xs transition-colors", activeView !== "equipos" && activeView !== "lista" && scope === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {s === "mes" ? "Mes" : s === "esta" ? "Esta semana" : "Próxima semana"}
            </button>
          ))}
        </div>
        <div className="h-5 w-px bg-border mx-0.5" />
        {/* Lentes secundarias */}
        <Button size="sm" variant={lens === "equipos" ? "default" : "outline"} onClick={() => setLens(l => l === "equipos" ? "calendario" : "equipos")} className="h-8">Equipos</Button>
        <Button size="sm" variant={lens === "lista" ? "default" : "outline"} onClick={() => setLens(l => l === "lista" ? "calendario" : "lista")} className="h-8">Lista</Button>
        <div className="h-5 w-px bg-border mx-0.5" />
        <Button size="sm" variant="outline" onClick={() => setContainerImportOpen(true)}><Ship className="h-4 w-4" />Container</Button>
        <Button size="sm" onClick={() => { setPresetSaleId(null); setNewOpen(true) }}><Plus className="h-4 w-4" />Programar</Button>
      </TopbarActions>

      <div className="px-4 lg:px-6 space-y-3">
        <FilterBar
          filters={filters} setFilters={setFilters} anyFilter={anyFilter}
          colocadorOptions={colocadorOptions} disenoOptions={disenoOptions}
          countColocador={(c) => countFor(e => e.crew === c)}
          countDiseno={(d) => countFor(e => e.kind === "obra" && !!e.designs?.some(x => x.design === d))}
          countEstado={(st) => countFor(e => e.kind === "obra" && e.estado === st)}
        />
        {/* Las tareas ("todo", bot de WhatsApp) NO van al calendario — solo a la vista Lista. */}
        {activeView === "mes" && <MonthView events={calendarEvents} sales={sales} matches={matches} onOpenObra={openObra} onOpenContainer={setDetailContainerId} onOpenMedicion={setMedicionTask} onOpenRemito={setInformeTask} />}
        {activeView === "semana" && <WeekView events={calendarEvents} scope={scope} matches={matches} onOpenObra={openObra} onOpenContainer={setDetailContainerId} />}
        {activeView === "equipos" && <TeamsView sales={sales} tasks={tasks} crews={crews} filters={filters} onOpenObra={openObra} />}
        {activeView === "lista" && <ListView events={events} matches={matches} onOpenObra={openObra} onOpenContainer={setDetailContainerId} />}
      </div>

      <ObraCardModal
        sale={modalSale} products={products} tasks={tasks} onClose={() => setModalSaleId(null)}
        onReprogramar={reprogramar} onMedicion={openMedicionForSale} onRemito={openRemitoForSale}
      />
      <NewEventSheet open={newOpen} onOpenChange={setNewOpen} sales={sales} crews={crews} presetSaleId={presetSaleId} />
      <ContainerImportForm open={containerImportOpen} onOpenChange={setContainerImportOpen} />
      <ContainerDetailSheet container={detailContainer} onClose={() => setDetailContainerId(null)} />
      <MedicionFormSheet task={medicionTask} sale={medicionTask?.sale_id ? sales.find(s => s.id === medicionTask.sale_id) ?? null : null} allTasks={tasks} onClose={() => setMedicionTask(null)} />
      <InformeFormSheet task={informeTask} sale={informeTask?.sale_id ? sales.find(s => s.id === informeTask.sale_id) ?? null : null} onClose={() => setInformeTask(null)} />
    </>
  )
}

// ===========================================================================
// Barra de filtros (leyenda de tipos + chips Colocador / Diseño / Estado)
// ===========================================================================
function FilterBar({ filters, setFilters, anyFilter, colocadorOptions, disenoOptions, countColocador, countDiseno, countEstado }: {
  filters: Filters; setFilters: (f: Filters) => void; anyFilter: boolean
  colocadorOptions: string[]; disenoOptions: string[]
  countColocador: (c: string) => number; countDiseno: (d: string) => number; countEstado: (s: string) => number
}) {
  const legend: EventKind[] = ["obra", "container", "medicion", "remito", "reparacion", "ausencia"]
  const Chip = ({ label, active, count, color, onClick }: { label: string; active: boolean; count?: number; color?: string; onClick: () => void }) => (
    <button onClick={onClick}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active ? "border-transparent text-primary-foreground" : "border-border bg-background text-foreground hover:bg-accent")}
      style={active ? { background: "var(--primary)" } : undefined}>
      {color && <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />}
      {label}{count != null && <span className="opacity-60 tabular">{count}</span>}
    </button>
  )
  const group = "flex items-center gap-1.5 flex-wrap"
  const glabel = "text-[11px] uppercase tracking-wide text-muted-foreground font-medium shrink-0"
  return (
    <Card className="p-3 gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className={glabel}>Tipos</span>
        {legend.map(k => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: k === "obra" ? "#3D3935" : EVENT_COLORS[k] }} />
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>
      <div className="h-px bg-border my-0.5" />
      <div className="flex flex-col gap-2">
        <div className={group}><span className={glabel}>Colocador</span>
          {colocadorOptions.map(c => <Chip key={c} label={c} count={countColocador(c)} color={crewColor(c)} active={filters.colocador === c} onClick={() => setFilters({ ...filters, colocador: filters.colocador === c ? null : c })} />)}
        </div>
        {/* Diseño — desplegable y solo en desktop (hay muchos diseños → ocuparían mucho como chips) */}
        {disenoOptions.length > 0 && (
          <div className={cn(group, "hidden lg:flex")}><span className={glabel}>Diseño</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors max-w-[240px]",
                  filters.diseno ? "border-transparent text-primary-foreground" : "border-border bg-background text-foreground hover:bg-accent")}
                  style={filters.diseno ? { background: "var(--primary)" } : undefined}>
                  <span className="truncate">{filters.diseno ?? "Todos los diseños"}</span>
                  <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
                <DropdownMenuItem onClick={() => setFilters({ ...filters, diseno: null })} className={cn(!filters.diseno && "bg-accent")}>Todos los diseños</DropdownMenuItem>
                <DropdownMenuSeparator />
                {disenoOptions.map(d => (
                  <DropdownMenuItem key={d} onClick={() => setFilters({ ...filters, diseno: d })} className={cn(filters.diseno === d && "bg-accent")}>
                    <span className="flex-1 truncate">{d}</span>
                    <span className="opacity-60 tabular ml-2">{countDiseno(d)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <div className={group}><span className={glabel}>Estado</span>
          {ESTADOS.map(s => <Chip key={s} label={s} count={countEstado(s)} color={ESTADO_COLOR[s]} active={filters.estado === s} onClick={() => setFilters({ ...filters, estado: filters.estado === s ? null : s })} />)}
          {anyFilter && <button onClick={() => setFilters({ colocador: null, diseno: null, estado: null })} className="ml-1 text-xs" style={{ color: "#9B3024" }}>✕ Limpiar</button>}
        </div>
      </div>
    </Card>
  )
}

// ===========================================================================
// Vista MES — celdas altas, barras multi-día con color de equipo + diseño
// ===========================================================================
function MonthView({ events, sales, matches, onOpenObra, onOpenContainer, onOpenMedicion, onOpenRemito }: {
  events: CalEvent[]; sales: Sale[]; matches: (e: CalEvent) => boolean
  onOpenObra: (id?: string) => void; onOpenContainer: (id: string) => void; onOpenMedicion: (t: Task) => void; onOpenRemito: (t: Task) => void
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [cursor, setCursor] = useState(startOfMonth(today))
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)
  const update = useAction(api.update)

  const cells = useMemo(() => daysGrid(cursor), [cursor])
  const monthLabel = cursor.toLocaleDateString(appLocale(), { month: "long", year: "numeric" })
  const dayDiff = (a: string, b: string) => Math.round((+new Date(a + "T12:00:00") - +new Date(b + "T12:00:00")) / 86400000)

  const weeks = useMemo(() => {
    const out: { days: typeof cells; segs: { e: CalEvent; col: number; span: number; lane: number; hasStart: boolean; hasEnd: boolean }[]; lanes: number }[] = []
    for (let w = 0; w < 6; w++) {
      const days = cells.slice(w * 7, w * 7 + 7)
      const ws = days[0].key, we = days[6].key
      const segs: { e: CalEvent; col: number; span: number; lane: number; hasStart: boolean; hasEnd: boolean }[] = []
      for (const e of events) {
        const sk = e.date, ek = e.endDate || e.date
        if (ek < ws || sk > we) continue
        const segStart = sk < ws ? ws : sk, segEnd = ek > we ? we : ek
        segs.push({ e, col: dayDiff(segStart, ws), span: dayDiff(segEnd, segStart) + 1, lane: 0, hasStart: sk >= ws, hasEnd: ek <= we })
      }
      segs.sort((a, b) => a.col - b.col || b.span - a.span)
      const laneEnd: number[] = []
      for (const s of segs) { let lane = 0; while (lane < laneEnd.length && laneEnd[lane] >= s.col) lane++; laneEnd[lane] = s.col + s.span - 1; s.lane = lane }
      out.push({ days, segs, lanes: laneEnd.length })
    }
    return out
  }, [cells, events])

  const colFromX = (e: React.DragEvent) => { const r = e.currentTarget.getBoundingClientRect(); return Math.max(0, Math.min(6, Math.floor((e.clientX - r.left) / (r.width / 7)))) }
  const HEADER_H = 34, LANE_H = 30
  const isDraggable = (e: CalEvent) => e.kind === "obra" || e.kind === "medicion" || e.kind === "remito" || e.kind === "reparacion" || e.kind === "ausencia"

  const handleDrop = async (date: string, e: React.DragEvent) => {
    e.preventDefault(); setDragOverDate(null); setDraggingKey(null)
    const payload = e.dataTransfer.getData("text/event"); if (!payload) return
    let data: { action?: "move" | "resize-end"; kind: string; saleId?: string; taskId?: string; fromDate: string }
    try { data = JSON.parse(payload) } catch { return }
    if (data.action === "resize-end" && data.saleId) {
      const sale = sales.find(s => s.id === data.saleId); if (!sale || !sale.delivery_date) return
      const start = sale.delivery_date.slice(0, 10); if (date < start) return
      const r = await update.run("sales", data.saleId, { delivery_date_to: date === start ? undefined : date }); if (r) refresh(); return
    }
    if (data.fromDate === date) return
    if (data.kind === "obra" && data.saleId) {
      const sale = sales.find(s => s.id === data.saleId)
      const totalDays = sale?.delivery_date && sale.delivery_date_to ? Math.max(1, Math.round((+new Date(sale.delivery_date_to + "T12:00:00") - +new Date(sale.delivery_date + "T12:00:00")) / 86400000) + 1) : 1
      const newEnd = new Date(date + "T12:00:00"); newEnd.setDate(newEnd.getDate() + totalDays - 1)
      const r = await update.run("sales", data.saleId, { delivery_date: date, delivery_date_to: totalDays > 1 ? newEnd.toISOString().slice(0, 10) : undefined }); if (r) refresh()
    } else if (data.taskId) {
      const r = await update.run("tasks", data.taskId, { due_date: date }); if (r) refresh()
    }
  }

  const clickEvent = (e: CalEvent) => {
    if (e.kind === "obra" && e.sale) onOpenObra(e.sale.id)
    else if (e.kind === "container" && e.containerId) onOpenContainer(e.containerId)
    else if (e.kind === "medicion" && e.task) onOpenMedicion(e.task)
    else if (e.kind === "remito" && e.task) onOpenRemito(e.task)
  }

  return (
    <Card className="p-0 overflow-hidden gap-0">
      <div className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border">
        <div className="text-lg font-light capitalize serif">{monthLabel}</div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setCursor(addMonths(cursor, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(startOfMonth(new Date()))} className="h-8">Hoy</Button>
          <Button variant="ghost" size="icon" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {WEEKDAYS.map((w) => <div key={w} className="px-2 py-2 text-[11px] uppercase tracking-wide text-muted-foreground font-medium border-r border-border last:border-r-0">{w}</div>)}
      </div>
      <div className="flex flex-col overflow-x-auto">
        {weeks.map((wk, wi) => {
          const minH = Math.max(92, HEADER_H + wk.lanes * LANE_H + 8)
          return (
            <div key={wi} className="relative border-b border-border last:border-b-0 min-w-[560px]" style={{ minHeight: minH }}
              onDragOver={(e) => { if (!draggingKey) return; e.preventDefault(); setDragOverDate(wk.days[colFromX(e)].key) }}
              onDragLeave={() => setDragOverDate(null)}
              onDrop={(e) => handleDrop(wk.days[colFromX(e)].key, e)}>
              <div className="grid grid-cols-7 absolute inset-0">
                {wk.days.map((c, ci) => {
                  const over = draggingKey != null && dragOverDate === c.key
                  return (
                    <div key={ci} className={cn("border-r border-border last:border-r-0 p-1.5", !c.inMonth && "bg-muted/20", over && "bg-primary/5 ring-1 ring-primary ring-inset")}>
                      <span className={cn("text-xs tabular", isToday(c.date) && "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground font-medium", !isToday(c.date) && !c.inMonth && "text-muted-foreground/60")}>{c.date.getDate()}</span>
                    </div>
                  )
                })}
              </div>
              {wk.segs.map((s, si) => {
                const e = s.e
                const color = eventColor(e)
                const canDrag = isDraggable(e)
                const evKey = e.id + "-" + wi
                const showResize = e.kind === "obra" && !!e.sale && s.hasEnd
                const dim = !matches(e)
                const design = e.designs?.[0]?.design
                return (
                  <div key={si} className="absolute px-0.5" style={{ left: `${(s.col / 7) * 100}%`, width: `${(s.span / 7) * 100}%`, top: HEADER_H + s.lane * LANE_H, opacity: dim ? 0.33 : 1 }}>
                    <div draggable={canDrag}
                      onDragStart={(ev) => { if (!canDrag) return; ev.stopPropagation(); ev.dataTransfer.setData("text/event", JSON.stringify({ action: "move", kind: e.kind, saleId: e.sale?.id, taskId: e.task?.id, fromDate: e.date })); ev.dataTransfer.effectAllowed = "move"; setDraggingKey(evKey) }}
                      onDragEnd={() => { setDraggingKey(null); setDragOverDate(null) }}
                      onClick={(ev) => { ev.stopPropagation(); clickEvent(e) }}
                      className={cn("h-[26px] rounded-md flex flex-col justify-center px-1.5 leading-none text-foreground overflow-hidden",
                        s.hasStart ? "" : "rounded-l-none", s.hasEnd ? "" : "rounded-r-none",
                        (canDrag || e.kind === "container") && "cursor-pointer", draggingKey === evKey && "opacity-50 ring-1 ring-primary")}
                      style={{ background: tint(color, 0.16), borderLeft: `3px solid ${color}` }}
                      title={`${e.title}${e.crew ? " · " + e.crew : ""}${design ? " · " + design : ""}${e.meta ? " · " + e.meta : ""}`}>
                      <div className="flex items-center gap-1">
                        {!s.hasStart && <span className="opacity-50 text-[10px]">‹</span>}
                        {(e.kind === "obra" && e.crew) ? <CrewAvatar crew={e.crew} size={13} /> : <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: color }} />}
                        <span className="truncate text-[11px] flex-1">{e.title}</span>
                        {showResize && (
                          <span draggable onDragStart={(ev) => { ev.stopPropagation(); ev.dataTransfer.setData("text/event", JSON.stringify({ action: "resize-end", kind: "obra", saleId: e.sale!.id, fromDate: e.date })); ev.dataTransfer.effectAllowed = "move"; setDraggingKey(evKey + ":resize") }} onDragEnd={() => { setDraggingKey(null); setDragOverDate(null) }} onClick={(ev) => ev.stopPropagation()} className="px-0.5 rounded cursor-ew-resize opacity-40 hover:opacity-100" title="Arrastrá al día final para extender"><GripVertical className="h-2.5 w-2.5" /></span>
                        )}
                        {!s.hasEnd && <span className="opacity-50 text-[10px]">›</span>}
                      </div>
                      {design && s.span > 1 && <div className="truncate text-[10px] text-muted-foreground pl-[18px]">{design}{e.totalM2 ? ` · ${e.totalM2} m²` : ""}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ===========================================================================
// Vista SEMANA — tarjetas ricas de obra por día (esta / próxima semana)
// ===========================================================================
function WeekView({ events, scope, matches, onOpenObra, onOpenContainer }: {
  events: CalEvent[]; scope: Scope; matches: (e: CalEvent) => boolean; onOpenObra: (id?: string) => void; onOpenContainer: (id: string) => void
}) {
  const base = scope === "proxima" ? addDays(startOfWeek(new Date()), 7) : startOfWeek(new Date())
  const days = weekDays(base)
  const from = days[0], to = days[6]
  const heading = `${scope === "proxima" ? "Próxima semana" : "Esta semana"} · ${from.toLocaleDateString(appLocale(), { day: "numeric", month: "short" })} → ${to.toLocaleDateString(appLocale(), { day: "numeric", month: "short" })}`
  const dayEvents = (d: Date) => { const k = dayKey(d); return events.filter(e => k >= e.date && k <= e.endDate) }

  return (
    <Card className="p-0 overflow-hidden gap-0">
      <div className="px-4 lg:px-6 py-3 border-b border-border"><div className="text-lg font-light capitalize serif">{heading}</div></div>
      <div className="grid grid-cols-1 sm:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-border">
        {days.map((d, i) => {
          const evs = dayEvents(d).sort((a, b) => (a.kind === "obra" ? 0 : 1) - (b.kind === "obra" ? 0 : 1))
          return (
            <div key={i} className={cn("min-h-[120px] p-2 space-y-2", isToday(d) && "bg-primary/5")}>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium flex items-center justify-between">
                <span>{WEEKDAYS[i]} {d.getDate()}</span>
              </div>
              {evs.length === 0 && <div className="text-[11px] text-muted-foreground/60 italic">—</div>}
              {evs.map(e => {
                const dim = !matches(e)
                if (e.kind === "obra") {
                  const color = crewColor(e.crew)
                  return (
                    <button key={e.id} onClick={() => onOpenObra(e.sale?.id)} style={{ opacity: dim ? 0.33 : 1, borderTop: `3px solid ${color}` }}
                      className="block w-full text-left rounded-md border border-border bg-card shadow-xs p-2 hover:bg-accent/40 transition-colors">
                      <div className="flex items-center gap-1.5 mb-1"><CrewAvatar crew={e.crew} size={20} /><span className="text-[11px] text-muted-foreground truncate">{e.crew || "Sin asignar"}</span></div>
                      <div className="text-[13px] truncate">{e.sale?.client_name || e.title}</div>
                      {e.address && <div className="text-[11px] text-muted-foreground truncate">{e.address}</div>}
                      {e.designs?.slice(0, 2).map((ds, j) => <div key={j} className="text-[11px] text-muted-foreground truncate">{ds.design} · {ds.m2} m²</div>)}
                      <div className="flex items-center justify-between gap-1 mt-1.5">
                        <EstadoBadge estado={e.estado} />
                        <MaterialDot state={e.material} />
                      </div>
                    </button>
                  )
                }
                if (e.kind === "reparacion" || e.kind === "ausencia") {
                  const color = EVENT_COLORS[e.kind]
                  return (
                    <div key={e.id} style={{ opacity: dim ? 0.33 : 1, borderLeft: `3px solid ${color}`, background: "var(--muted)" }} className="rounded-md px-2 py-1.5">
                      <div className="text-[12px]" style={{ color }}>{KIND_LABEL[e.kind]}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{[e.crew, e.detalle].filter(Boolean).join(" · ")}</div>
                    </div>
                  )
                }
                const color = eventColor(e)
                return (
                  <button key={e.id} onClick={() => e.containerId && onOpenContainer(e.containerId)} disabled={!e.containerId} style={{ opacity: dim ? 0.33 : 1, background: tint(color, 0.16), color }} className="block w-full text-left rounded-full px-2 py-1 text-[11px] truncate">
                    {KIND_LABEL[e.kind]} · {e.title}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ===========================================================================
// ObraCard — modal de detalle de la obra
// ===========================================================================
function ObraCardModal({ sale, products, tasks, onClose, onReprogramar, onMedicion, onRemito }: {
  sale: Sale | null; products: Product[]; tasks: Task[]; onClose: () => void
  onReprogramar: (id: string) => void; onMedicion: (id: string) => void; onRemito: (id: string) => void
}) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { setExpanded(false) }, [sale?.id])
  useEffect(() => {
    if (!sale) return
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [sale, onClose])
  if (!sale) return null
  const color = crewColor(sale.delivery_crew)
  const p = saleToPlacement(sale)
  const designs = deriveDesigns(sale.items, products)
  const material = materialState(sale)
  const medicion = tasks.find(t => t.type === "medicion" && t.sale_id === sale.id && t.status !== "cancelada")
  const remito = tasks.find(t => t.type === "remito" && t.sale_id === sale.id && t.status !== "cancelada")
  const md = sale.medicion_data
  const rangeLabel = p ? (p.totalDays > 1 ? `${p.start.toLocaleDateString(appLocale(), { day: "numeric", month: "short" })} → ${p.end.toLocaleDateString(appLocale(), { day: "numeric", month: "short" })} · ${p.totalDays} días` : p.start.toLocaleDateString(appLocale(), { weekday: "long", day: "numeric", month: "long" })) : "Sin fecha"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(26,24,21,0.45)" }} onClick={onClose}>
      <div className="w-full max-w-[540px] max-h-[88vh] overflow-y-auto rounded-lg bg-card border border-border shadow-lg" style={{ borderTop: `5px solid ${color}` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="flex items-center gap-3">
            <CrewAvatar crew={sale.delivery_crew} size={38} />
            <div>
              <div className="text-[15px]">{sale.delivery_crew || "Sin asignar"}</div>
              <div className="text-xs text-muted-foreground">Colocador asignado</div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[15px]">{sale.client_name}</div>
              {sale.client_address && <div className="text-xs text-muted-foreground">{sale.client_address}</div>}
            </div>
            <EstadoBadge estado={sale.status} />
          </div>

          <div className="rounded-lg bg-muted/60 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Piso a colocar</div>
            {designs.length === 0 ? <div className="text-[13px] text-muted-foreground">Sin pisos con producto vinculado</div>
              : designs.map((d, i) => <div key={i} className="text-[13px] flex items-center justify-between gap-2"><span className="truncate">{d.design}</span><span className="tabular text-muted-foreground shrink-0">{d.m2} m²</span></div>)}
          </div>

          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{rangeLabel}</span>
            <MaterialDot state={material} showLabel />
          </div>

          <button onClick={() => setExpanded(x => !x)} className="text-xs underline text-muted-foreground hover:text-foreground">{expanded ? "− Ver menos" : "+ Ver medición y notas"}</button>
          {expanded && (
            <div className="rounded-md border border-border p-3 text-xs space-y-1">
              {md?.m2_medidos != null ? <div>Medición: <span className="tabular text-foreground">{md.m2_medidos}</span> / {md.m2_cotizados ?? "—"} m² medidos{md.m2_cotizados ? ` (${Math.round((md.m2_medidos / md.m2_cotizados) * 100)}%)` : ""}</div> : <div className="text-muted-foreground">Sin medición registrada.</div>}
              {sale.delivery_notes && <div>Notas: {sale.delivery_notes}</div>}
              {md?.observaciones && <div>Obs. medición: {md.observaciones}</div>}
            </div>
          )}

          <div className="grid grid-cols-4 gap-1.5 pt-1">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => onReprogramar(sale.id)}>Editar</Button>
            <Button variant="outline" size="sm" className="text-xs" disabled={!medicion} onClick={() => medicion && onMedicion(sale.id)}>Medición</Button>
            {/* El remito DOCUMENTO siempre se puede ver (el PDF deriva de la venta aunque
                nadie lo haya preparado); el CIERRE (tarea) es otra acción, solo si existe. */}
            <Button variant="outline" size="sm" className="text-xs" onClick={() => window.open(`/api/sales/${sale.id}/remito`, "_blank")}>Ver remito</Button>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => { onClose(); navigate(`/ventas?sale=${sale.id}`) }}>Ver venta</Button>
          </div>
          {remito && remito.status !== "completada" && (
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => onRemito(sale.id)}>Cerrar remito (entrega y conformidad)</Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// Vista EQUIPOS — disponibilidad crew × semana (obras + reparación/ausencia)
// ===========================================================================
function TeamsView({ sales, tasks, crews, filters, onOpenObra }: { sales: Sale[]; tasks: Task[]; crews: string[]; filters: Filters; onOpenObra: (id?: string) => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [weekStart, setWeekStart] = useState(startOfWeek(today))
  const days = useMemo(() => weekDays(weekStart), [weekStart])
  const rows = useMemo(() => [...crews, "Sin asignar / Externo"], [crews])
  const rowFor = (crew?: string | null) => (crew && crews.includes(crew)) ? crew : "Sin asignar / Externo"
  const isWeekend = (d: Date) => { const w = d.getDay(); return w === 0 || w === 6 }

  type Occ = { kind: "obra" | "reparacion" | "ausencia"; label: string; saleId?: string; color: string }
  const occFor = (crew: string, d: Date): Occ[] => {
    const k = dayKey(d)
    const out: Occ[] = []
    for (const s of sales) {
      if (s.status === "Cancelado" || !s.delivery_date) continue
      const from = s.delivery_date.slice(0, 10)
      const to = (s.delivery_date_to && s.delivery_date_to >= from ? s.delivery_date_to : from).slice(0, 10)
      if (rowFor(s.delivery_crew) !== crew || k < from || k > to) continue
      if (filters.diseno || filters.estado) continue   // dim: la vista Equipos filtra por colocador; diseño/estado no aplican acá
      out.push({ kind: "obra", label: s.client_name, saleId: s.id, color: crewColor(s.delivery_crew) })
    }
    for (const t of tasks) {
      if (t.status === "cancelada" || (t.type !== "reparacion" && t.type !== "ausencia")) continue
      const from = t.due_date.slice(0, 10)
      const to = (t.due_date_to && t.due_date_to >= from ? t.due_date_to : from).slice(0, 10)
      if (rowFor(t.assigned_seller) !== crew || k < from || k > to) continue
      out.push({ kind: t.type, label: TASK_TYPE_LABEL[t.type], color: EVENT_COLORS[t.type] })
    }
    return out
  }
  const busyDays = (crew: string) => days.filter(d => occFor(crew, d).length > 0).length
  const label = days[0].toLocaleDateString(appLocale(), { day: "numeric", month: "short" }) + " – " + days[6].toLocaleDateString(appLocale(), { day: "numeric", month: "short", year: "numeric" })
  const colocadorFilter = filters.colocador

  return (
    <Card className="p-0 overflow-hidden gap-0">
      <div className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border">
        <div><div className="text-lg font-light serif">Disponibilidad de equipos</div><div className="text-xs text-muted-foreground">{label}</div></div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(d => addDays(d, -7))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))} className="h-8">Esta semana</Button>
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(d => addDays(d, 7))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid text-white" style={{ gridTemplateColumns: "190px repeat(7, 1fr)", background: "#1A1815" }}>
            <div className="px-3 py-2 text-[11px] uppercase tracking-wide">Equipo</div>
            {days.map((d, i) => <div key={i} className="px-2 py-2 text-[11px] border-l border-white/10"><span className="uppercase tracking-wide">{WEEKDAYS[i]}</span> <span className="tabular opacity-80">{d.getDate()}</span></div>)}
          </div>
          {rows.map((crew, ri) => {
            const isUnassigned = crew === "Sin asignar / Externo"
            const dimRow = colocadorFilter && crew !== colocadorFilter
            const busy = busyDays(crew)
            return (
              <div key={ri} className="grid border-b border-border last:border-b-0" style={{ gridTemplateColumns: "190px repeat(7, 1fr)", opacity: dimRow ? 0.33 : 1 }}>
                <div className="px-3 py-2 border-r border-border flex flex-col justify-center">
                  <div className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full" style={{ background: isUnassigned ? CREW_FALLBACK : crewColor(crew) }} /><span className={cn("text-sm truncate", isUnassigned && "text-muted-foreground")}>{crew}</span></div>
                  {!isUnassigned && <div className="text-[10px] text-muted-foreground mt-0.5">{busy === 0 ? "libre toda la semana" : `${busy}/7 ocupado · ${7 - busy} libre${7 - busy === 1 ? "" : "s"}`}</div>}
                </div>
                {days.map((d, di) => {
                  const list = occFor(crew, d)
                  const free = list.length === 0 && !isUnassigned
                  return (
                    <div key={di} className={cn("min-h-[56px] p-1.5 border-l border-border space-y-1", isWeekend(d) && "bg-muted/20")} style={free ? { background: tint("#3C6E47", 0.12) } : undefined}>
                      {free && <div className="text-[11px]" style={{ color: "#3C6E47" }}>Libre</div>}
                      {list.map((o, oi) => (
                        <button key={oi} disabled={!o.saleId} onClick={() => o.saleId && onOpenObra(o.saleId)} className="block w-full text-left text-[10px] rounded px-1.5 py-1 leading-tight truncate" style={{ background: tint(o.color, 0.16), color: o.color }} title={o.label}>{o.label}</button>
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <div className="px-4 lg:px-6 py-2.5 border-t border-border text-[11px] text-muted-foreground">Verde = día libre. Reparación/Ausencia ocupan al equipo. Asigná el equipo desde la venta o al programar.</div>
    </Card>
  )
}

// ===========================================================================
// Vista LISTA — tabla plana de todos los eventos del período
// ===========================================================================
function ListView({ events, matches, onOpenObra, onOpenContainer }: { events: CalEvent[]; matches: (e: CalEvent) => boolean; onOpenObra: (id?: string) => void; onOpenContainer: (id: string) => void }) {
  const rows = useMemo(() => [...events].sort((a, b) => a.ts - b.ts), [events])
  return (
    <Card className="p-0 overflow-hidden gap-0">
      <div className="px-4 lg:px-6 py-3 border-b border-border"><div className="text-lg font-light serif">Lista de eventos</div></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead><tr className="text-white text-[11px] uppercase tracking-wide" style={{ background: "#1A1815" }}>
            <th className="text-left px-3 py-2 font-medium">Fecha</th><th className="text-left px-3 py-2 font-medium">Tipo</th><th className="text-left px-3 py-2 font-medium">Colocador</th><th className="text-left px-3 py-2 font-medium">Diseño · m²</th><th className="text-left px-3 py-2 font-medium">Dirección</th><th className="text-left px-3 py-2 font-medium">Estado</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No hay eventos.</td></tr>}
            {rows.map(e => {
              const color = eventColor(e)
              const dim = !matches(e)
              const clickable = (e.kind === "obra" && e.sale) || (e.kind === "container" && e.containerId)
              return (
                <tr key={e.id} onClick={() => { if (e.kind === "obra" && e.sale) onOpenObra(e.sale.id); else if (e.kind === "container" && e.containerId) onOpenContainer(e.containerId) }}
                  className={cn("border-b border-border last:border-b-0", clickable && "cursor-pointer hover:bg-accent/40")} style={{ opacity: dim ? 0.4 : 1 }}>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">{new Date(e.date + "T12:00:00").toLocaleDateString(appLocale(), { day: "numeric", month: "short" })}{e.endDate !== e.date ? ` → ${new Date(e.endDate + "T12:00:00").toLocaleDateString(appLocale(), { day: "numeric", month: "short" })}` : ""}</td>
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5" style={{ color }}><span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />{KIND_LABEL[e.kind]}</span></td>
                  <td className="px-3 py-2 text-xs">{e.crew || "—"}</td>
                  <td className="px-3 py-2 text-xs">{e.designs?.length ? `${e.designs[0].design}${e.designs.length > 1 ? ` +${e.designs.length - 1}` : ""}${e.totalM2 ? ` · ${e.totalM2} m²` : ""}` : (e.title || e.detalle || "—")}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[220px]">{e.address || "—"}</td>
                  <td className="px-3 py-2">{e.estado ? <EstadoBadge estado={e.estado} /> : "—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ===========================================================================
// NewEventSheet — crear entrega / medición / reparación / ausencia / etc.
// ===========================================================================
function NewEventSheet({ open, onOpenChange, sales, crews, presetSaleId }: { open: boolean; onOpenChange: (o: boolean) => void; sales: Sale[]; crews: string[]; presetSaleId?: string | null }) {
  const settings = useApi<{ sellers?: { name: string }[] }>("/api/settings").data
  const sellers = settings?.sellers ?? []
  const PICKER: TaskType[] = ["entrega", ...TASK_TYPE_ORDER]
  const [type, setType] = useState<TaskType>("entrega")
  const [title, setTitle] = useState("")
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState<string>("")
  const [seller, setSeller] = useState<string>("")
  const [saleId, setSaleId] = useState<string>("")
  const [notes, setNotes] = useState("")
  const create = useAction(api.create)
  const update = useAction(api.update)
  const txn = useAction(api.saleTransition)

  useEffect(() => {
    if (!open) return
    setTitle("")
    if (presetSaleId) {
      // Editar la programación existente: pre-llenar con los valores actuales de la venta
      // (equipo, fechas, notas) → se puede cambiar colocador, ajustar día o poner fecha "hasta".
      const s = sales.find(x => x.id === presetSaleId)
      setType("entrega"); setSaleId(presetSaleId)
      setDate(s?.delivery_date ? s.delivery_date.slice(0, 10) : new Date().toISOString().slice(0, 10))
      setDateTo(s?.delivery_date_to ? s.delivery_date_to.slice(0, 10) : "")
      setSeller(s?.delivery_crew ?? "")
      setNotes(s?.delivery_notes ?? "")
    } else {
      setType("entrega"); setSaleId(""); setDate(new Date().toISOString().slice(0, 10)); setDateTo(""); setSeller(""); setNotes("")
    }
  }, [open, presetSaleId])

  const selectedSale = saleId ? sales.find(s => s.id === saleId) ?? null : null
  useEffect(() => { if (type !== "entrega" || !selectedSale || title) return; setTitle(`Entrega · ${selectedSale.client_name}`) }, [selectedSale?.id, type])

  const linkableSales = useMemo(() => sales.filter(s => ["Confirmado", "Programado", "En proceso"].includes(s.status)), [sales])
  const saleItems = useMemo(() => linkableSales.map(s => ({
    id: s.id, label: saleLabel(s),
    sub: s.delivery_date ? `Programada · ${new Date(s.delivery_date).toLocaleDateString(appLocale())}` : "Sin entrega programada",
    hint: fmtMoney(s.contract_total), keywords: `${s.client_name} ${s.quote_number} ${s.title || ""}`,
  })), [linkableSales])
  const isEntrega = type === "entrega"
  const isCrewTask = type === "reparacion" || type === "ausencia"    // ocupan a un equipo, admiten rango
  const canSubmit = !!date && (isEntrega ? !!saleId : !!title)

  const submit = async () => {
    if (!canSubmit) return
    const effectiveTo = dateTo && dateTo >= date ? dateTo : ""   // fecha "hasta" válida (rango) o vacío
    if (isEntrega && selectedSale) {
      const isFirstSchedule = !selectedSale.delivery_date
      await update.run("sales", selectedSale.id, { delivery_date: date, delivery_date_to: effectiveTo || undefined, delivery_crew: seller || undefined, delivery_notes: notes || undefined })
      if (selectedSale.status === "Confirmado") await txn.run(selectedSale.id, "Programado")
      if (isFirstSchedule) {
        const m = new Date(date); m.setDate(m.getDate() - 2)
        await create.run("tasks", { type: "medicion", title: `Medición previa · ${selectedSale.client_name}`, due_date: m.toISOString().slice(0, 10), assigned_seller: seller || selectedSale.seller_name || undefined, status: "pendiente", sale_id: selectedSale.id, notes: selectedSale.client_address || "", created_at: new Date().toISOString() })
      }
      onOpenChange(false); refresh(); return
    }
    const r = await create.run("tasks", { type, title, due_date: date, due_date_to: effectiveTo || undefined, assigned_seller: seller || undefined, status: "pendiente", sale_id: saleId || undefined, notes: notes || undefined, created_at: new Date().toISOString() })
    if (r) { onOpenChange(false); refresh() }
  }
  const selCls = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader><SheetTitle>{presetSaleId ? "Editar programación" : "Programar evento"}</SheetTitle><SheetDescription>{presetSaleId ? "Cambiá el equipo, las fechas o las notas de la colocación" : "Entrega, medición, reparación, ausencia u otra tarea"}</SheetDescription></SheetHeader>
        <div className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium block mb-1.5 uppercase tracking-wide text-muted-foreground">Tipo</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PICKER.map(t => {
                const active = type === t
                const color = t === "entrega" ? "#3D3935" : (EVENT_COLORS[taskKindToEventKind(t)] ?? "#7A746C")
                return <button key={t} type="button" onClick={() => setType(t)} className={cn("flex items-center gap-1.5 rounded-md border px-2 py-2 text-xs transition-colors", active ? "font-medium" : "border-border hover:bg-accent")} style={active ? { background: tint(color, 0.16), borderColor: color, color } : undefined}><span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />{TASK_TYPE_LABEL[t]}</button>
              })}
            </div>
          </div>

          {isEntrega ? (
            <>
              <div>
                <label className="text-sm font-medium block mb-1">{presetSaleId ? "Editando la programación de" : "Venta a entregar"}</label>
                {selectedSale ? (
                  <div className="flex items-center justify-between border border-border rounded-md px-3 h-9 text-sm bg-muted/30">
                    <span className="truncate">{saleLabel(selectedSale)}</span>
                    {!presetSaleId && <button type="button" className="text-xs text-muted-foreground hover:text-foreground shrink-0 ml-2" onClick={() => setSaleId("")}>cambiar</button>}
                  </div>
                ) : (
                  <SearchPicker items={saleItems} placeholder="Buscar venta por cliente o número…" onPick={setSaleId} />
                )}
                {selectedSale?.client_address && <div className="text-[10px] text-muted-foreground mt-1">📍 {selectedSale.client_address}</div>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium block mb-1">Colocación desde</label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                <div><label className="text-sm font-medium block mb-1">Hasta <span className="text-muted-foreground font-normal">(opcional)</span></label><Input type="date" value={dateTo} min={date || undefined} onChange={(e) => setDateTo(e.target.value)} /></div>
              </div>
              <div><label className="text-sm font-medium block mb-1">Equipo de colocación</label>
                <select value={seller} onChange={(e) => setSeller(e.target.value)} className={selCls}><option value="">— Sin asignar —</option>{crews.map(c => <option key={c} value={c}>{c}</option>)}{seller && !crews.includes(seller) && seller !== "Externo" && <option value={seller}>{seller}</option>}<option value="Externo">Externo / otro</option></select>
              </div>
              <div><label className="text-sm font-medium block mb-1">Notas de entrega</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ascensor de carga, llaves con portero…" /></div>
              {!presetSaleId && <div className="text-[11px] text-muted-foreground rounded-md bg-muted/40 border border-border px-3 py-2">Al programar se pasa la venta a <strong>Programado</strong> y se crea la <strong>Medición previa</strong> (−2 días).</div>}
            </>
          ) : (
            <>
              <div><label className="text-sm font-medium block mb-1">Título</label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isCrewTask ? (type === "ausencia" ? "Vacaciones / franco" : "Reparación Obra Pilar") : "Medición Familia Pérez / Remito…"} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium block mb-1">{isCrewTask ? "Desde" : "Fecha"}</label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                {isCrewTask
                  ? <div><label className="text-sm font-medium block mb-1">Hasta <span className="text-muted-foreground font-normal">(opcional)</span></label><Input type="date" value={dateTo} min={date || undefined} onChange={(e) => setDateTo(e.target.value)} /></div>
                  : <div><label className="text-sm font-medium block mb-1">Responsable</label><select value={seller} onChange={(e) => setSeller(e.target.value)} className={selCls}><option value="">— Sin asignar —</option><optgroup label="Vendedores">{sellers.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}</optgroup><optgroup label="Equipos">{crews.map(c => <option key={c} value={c}>{c}</option>)}</optgroup></select></div>}
              </div>
              {isCrewTask && (
                <div><label className="text-sm font-medium block mb-1">Equipo {type === "ausencia" ? "ausente" : "que repara"}</label>
                  <select value={seller} onChange={(e) => setSeller(e.target.value)} className={selCls}><option value="">— Elegí el equipo —</option>{crews.map(c => <option key={c} value={c}>{c}</option>)}</select>
                  <div className="text-[10px] text-muted-foreground mt-1">Ocupa a este equipo en la vista de disponibilidad.</div>
                </div>
              )}
              {type === "reparacion" && (
                <div><label className="text-sm font-medium block mb-1">Cliente / obra <span className="text-muted-foreground font-normal">(opcional)</span></label>
                  <select value={saleId} onChange={(e) => setSaleId(e.target.value)} className={selCls}><option value="">— Ninguna —</option>{sales.map(s => <option key={s.id} value={s.id}>{saleLabel(s)}</option>)}</select>
                </div>
              )}
              <div><label className="text-sm font-medium block mb-1">Notas (opcional)</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detalles, dirección, contacto…" /></div>
            </>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={submit} disabled={create.busy || update.busy || txn.busy || !canSubmit}>{create.busy || update.busy || txn.busy ? "Guardando…" : isEntrega ? (presetSaleId ? "Guardar cambios" : "Programar entrega") : "Programar"}</Button>
            {create.error && <span className="text-xs text-destructive">{create.error}</span>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ===========================================================================
// MedicionFormSheet — registrar medición (preservado)
// ===========================================================================
type ExtraRow = { description: string; quantity: number; sku?: string }
function MedicionFormSheet({ task, sale, allTasks, onClose }: { task: Task | null; sale: Sale | null; allTasks: Task[]; onClose: () => void }) {
  const navigate = useNavigate()
  const [m2, setM2] = useState<number>(0)
  const [superficie, setSuperficie] = useState<string>("Contrapiso nuevo")
  const [observaciones, setObservaciones] = useState<string>("")
  const [extrasItems, setExtrasItems] = useState<ExtraRow[]>([])
  const [markDone, setMarkDone] = useState<boolean>(true)
  const update = useAction(api.update)
  const create = useAction(api.create)
  const quotedTotalM2 = (sale?.items ?? []).reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)

  useEffect(() => {
    if (!task) return
    const d = task.medicion_data ?? {}
    setM2(d.m2_medidos ?? quotedTotalM2 ?? 0)
    setSuperficie(d.superficie ?? "Contrapiso nuevo")
    setObservaciones(d.observaciones ?? "")
    setExtrasItems(d.extras_items ?? (d.extras ? [{ description: d.extras, quantity: 1 }] : []))
    setMarkDone(task.status !== "completada")
  }, [task?.id])

  if (!task) return null
  const addExtra = () => setExtrasItems(prev => [...prev, { description: "", quantity: 1 }])
  const updateExtra = (i: number, patch: Partial<ExtraRow>) => setExtrasItems(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const removeExtra = (i: number) => setExtrasItems(prev => prev.filter((_, idx) => idx !== i))
  const diff = m2 - quotedTotalM2
  const diffPct = quotedTotalM2 > 0 ? (diff / quotedTotalM2) * 100 : 0

  const submit = async () => {
    const cleanExtras = extrasItems.filter(x => (x.description ?? "").trim() && (Number(x.quantity) || 0) > 0)
    const payload = { m2_medidos: m2 || undefined, m2_cotizados: quotedTotalM2 || undefined, superficie, observaciones: observaciones || undefined, extras_items: cleanExtras.length > 0 ? cleanExtras : undefined, recorded_at: new Date().toISOString(), recorded_by: task.assigned_seller }
    await update.run("tasks", task.id, { medicion_data: payload, status: markDone ? "completada" : task.status, completed_at: markDone ? new Date().toISOString() : undefined })
    if (sale) {
      // La medición ARMA el remito: materiales de la venta + extras detectados. Solo si la
      // venta aún no tiene un remito guardado (no pisa la lista curada del inspector).
      const seedRemito = !(sale.remito_items?.length)
        ? { remito_items: [...saleMaterialsForRemito(sale.items), ...cleanExtras.map(x => ({ description: x.description, quantity: Number(x.quantity) || 0, unit: looseUnit(x.description) }))] }
        : {}
      await update.run("sales", sale.id, { medicion_data: payload, ...seedRemito })
    }
    if (markDone && sale && sale.delivery_date) {
      const existingRemito = allTasks.find(t => t.type === "remito" && t.sale_id === sale.id && t.status !== "cancelada")
      if (!existingRemito) await create.run("tasks", { type: "remito", title: `Remito · ${sale.client_name}`, due_date: sale.delivery_date_to || sale.delivery_date.slice(0, 10), assigned_seller: task.assigned_seller || sale.seller_name || undefined, status: "pendiente", sale_id: sale.id, notes: sale.client_address || "", created_at: new Date().toISOString() })
    }
    onClose(); refresh()
  }
  return (
    <Sheet open={!!task} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader><SheetTitle>Registrar medición</SheetTitle><SheetDescription>{task.title}{sale ? ` · ${sale.client_address ?? ""}` : ""}</SheetDescription></SheetHeader>
        <div className="mt-6 space-y-4">
          {sale && <div className="rounded-md border border-border p-3 bg-muted/40 text-xs space-y-0.5"><div className="font-medium text-sm">{sale.client_name}</div>{sale.client_address && <div className="text-muted-foreground">📍 {sale.client_address}</div>}<div className="text-muted-foreground">Venta #{sale.quote_number} · {fmtMoney(sale.contract_total)}</div></div>}
          {(sale?.items?.length ?? 0) > 0 && (
            <div className="rounded-md border border-border">
              <div className="px-3 py-2 border-b border-border flex items-center justify-between"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">Items cotizados</div><div className="text-[10px] text-muted-foreground tabular">{quotedTotalM2} m² total</div></div>
              <div className="divide-y divide-border max-h-40 overflow-y-auto">{sale!.items.map((it, i) => <div key={i} className="px-3 py-1.5 flex items-center justify-between text-xs gap-2"><div className="min-w-0"><div className="truncate">{it.description}</div><div className="text-[10px] text-muted-foreground">{it.sku}</div></div><div className="tabular text-muted-foreground shrink-0">{it.quantity}</div></div>)}</div>
            </div>
          )}
          <div>
            <label className="text-sm font-medium block mb-1">m² medidos en obra</label>
            <Input type="number" step="0.1" min={0} value={m2} onChange={(e) => setM2(Number(e.target.value) || 0)} />
            {quotedTotalM2 > 0 && <div className="text-[11px] mt-1 tabular">Cotizado: <span className="text-foreground">{quotedTotalM2}</span> · Medido: <span className="text-foreground">{m2 || "—"}</span>{m2 > 0 && <span className={cn("ml-1 font-medium", Math.abs(diff) < 0.5 ? "text-muted-foreground" : diff > 0 ? "text-amber-700" : "text-blue-700")}> · {diff > 0 ? "+" : ""}{diff.toFixed(1)} m² ({diffPct >= 0 ? "+" : ""}{diffPct.toFixed(1)}%)</span>}</div>}
          </div>
          <div><label className="text-sm font-medium block mb-1">Tipo de superficie</label><select value={superficie} onChange={(e) => setSuperficie(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option>Contrapiso nuevo</option><option>Contrapiso existente</option><option>Piso de madera existente</option><option>Cemento alisado</option><option>Cerámico (a remover)</option><option>Otro</option></select></div>
          <div><label className="text-sm font-medium block mb-1">Observaciones</label><Input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Nivelación, humedad, escalones, etc." /></div>
          <div>
            <div className="flex items-center justify-between mb-1.5"><label className="text-sm font-medium">Extras detectados</label><button type="button" onClick={addExtra} className="text-xs text-primary hover:underline inline-flex items-center gap-1"><Plus className="h-3 w-3" />Agregar</button></div>
            {extrasItems.length === 0 ? <div className="text-[11px] text-muted-foreground italic border border-dashed border-border rounded-md p-2 text-center">Sin extras. Agregá zócalos, narices, ajustes, etc.</div> : <div className="space-y-2">{extrasItems.map((row, i) => <div key={i} className="grid grid-cols-[1fr_72px_28px] gap-1.5 items-center"><Input value={row.description} onChange={(e) => updateExtra(i, { description: e.target.value })} placeholder="Descripción del extra" className="h-8 text-xs" /><Input type="number" step="0.1" min={0} value={row.quantity} onChange={(e) => updateExtra(i, { quantity: Number(e.target.value) || 0 })} className="h-8 text-xs" /><button type="button" onClick={() => removeExtra(i)} className="h-8 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-destructive" aria-label="Quitar">×</button></div>)}</div>}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} />Marcar la medición como completada</label>
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <Button onClick={submit} disabled={update.busy}>{update.busy ? "Guardando…" : "Guardar medición"}</Button>
            {sale && <Button variant="outline" onClick={() => { onClose(); navigate(`/ventas?sale=${sale.id}`) }}>Ver venta</Button>}
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
          </div>
          <div className="text-[11px] text-muted-foreground">Al guardar se arma el remito con los materiales de la venta + los extras, y se crea la tarea Remito para el día de la entrega.</div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ===========================================================================
// InformeFormSheet — remito / cierre (preservado)
// ===========================================================================
function InformeFormSheet({ task, sale, onClose }: { task: Task | null; sale: Sale | null; onClose: () => void }) {
  const navigate = useNavigate()
  const [observaciones, setObservaciones] = useState<string>("")
  const [m2Entregados, setM2Entregados] = useState<number>(0)
  const [conformidad, setConformidad] = useState<boolean>(true)
  const update = useAction(api.update)
  const txn = useAction(api.saleTransition)
  useEffect(() => { if (!task) return; const md = sale?.medicion_data; setObservaciones(md?.observaciones ?? task.notes ?? ""); setM2Entregados(md?.m2_medidos ?? 0); setConformidad(true) }, [task?.id, sale?.id])
  if (!task) return null
  const submit = async () => {
    await update.run("tasks", task.id, { status: "completada", completed_at: new Date().toISOString(), notes: [`m² entregados: ${m2Entregados}`, `Conformidad: ${conformidad ? "Sí" : "No"}`, observaciones].filter(Boolean).join(" · ") })
    if (sale && conformidad && sale.status !== "Finalizado") await txn.run(sale.id, "Finalizado")
    onClose(); refresh()
  }
  const md = sale?.medicion_data
  return (
    <Sheet open={!!task} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader><SheetTitle>Remito</SheetTitle><SheetDescription>{task.title}{sale ? ` · ${sale.client_address ?? ""}` : ""}</SheetDescription></SheetHeader>
        <div className="mt-6 space-y-4">
          {sale && <div className="rounded-md border border-border p-3 bg-muted/40 text-xs space-y-0.5"><div className="font-medium text-sm">{sale.client_name}</div><div className="text-muted-foreground">Venta #{sale.quote_number} · {fmtMoney(sale.contract_total)}</div>{sale.delivery_date && <div className="text-muted-foreground">Entrega: {new Date(sale.delivery_date).toLocaleDateString(appLocale())}</div>}</div>}
          {md ? (
            <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 p-3 text-xs space-y-0.5">
              <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400 font-medium">Datos de medición previa</div>
              {md.m2_medidos != null && <div>m² medidos: <span className="tabular">{md.m2_medidos}</span>{md.m2_cotizados != null && <span className="text-muted-foreground"> · cotizado {md.m2_cotizados}</span>}</div>}
              {md.superficie && <div>Superficie: {md.superficie}</div>}
              {md.observaciones && <div>Obs: {md.observaciones}</div>}
              {md.extras_items && md.extras_items.length > 0 && <div><div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mt-1.5">Extras detectados</div><ul className="list-disc list-inside">{md.extras_items.map((x, i) => <li key={i}>{x.description} <span className="tabular text-muted-foreground">× {x.quantity}</span></li>)}</ul></div>}
              {!md.extras_items && md.extras && <div>Extras: {md.extras}</div>}
            </div>
          ) : <div className="text-[11px] text-muted-foreground italic">Sin datos de medición previa — completá manualmente.</div>}
          <div><label className="text-sm font-medium block mb-1">m² efectivamente entregados</label><Input type="number" step="0.1" min={0} value={m2Entregados} onChange={(e) => setM2Entregados(Number(e.target.value) || 0)} /></div>
          <div><label className="text-sm font-medium block mb-1">Observaciones de cierre</label><Input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Detalles de la entrega/instalación" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={conformidad} onChange={(e) => setConformidad(e.target.checked)} />Cliente firmó conformidad — finalizar venta (descontar stock)</label>
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <Button onClick={submit} disabled={update.busy || txn.busy}>{update.busy || txn.busy ? "Guardando…" : "Cerrar remito"}</Button>
            {sale && <Button variant="outline" onClick={() => window.open(`/api/sales/${sale.id}/remito`, "_blank")}><Truck className="h-4 w-4" />Ver / imprimir remito</Button>}
            {sale && <Button variant="outline" onClick={() => { onClose(); navigate(`/ventas?sale=${sale.id}`) }}>Ver venta</Button>}
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
