import { useEffect, useMemo, useState } from "react"
import { Calendar, Ship, ChevronLeft, ChevronRight, List, CalendarDays, Wrench, Building, PhoneCall, CircleDot, FileCheck2, Plus, GripVertical, Users } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { Input } from "@/components/ui/input"
import { fmtMoney } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import type { Sale, Container } from "@/lib/types"
import { type Task, type TaskType, TASK_TYPE_LABEL, TASK_TYPE_ORDER } from "@/lib/tasks"

type EventKind = "delivery" | "container" | "medicion" | "remito" | "visita" | "seguimiento" | "otro"
type Event = { ts: number; date: string; kind: EventKind; title: string; subtitle: string; meta?: string; crew?: string; taskId?: string; saleId?: string; status?: string; task?: Task; dayIndex?: number; totalDays?: number }
type View = "lista" | "calendario" | "equipos"

// Etiqueta para reconocer una venta: obra primero, después cliente y nº.
const saleLabel = (s: Sale) => `${s.title || s.client_name} · ${s.client_name} · #${s.quote_number}`

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

const KIND_STYLE: Record<EventKind, { label: string; icon: React.ComponentType<{ className?: string }>; bg: string; border: string; dot: string; text: string }> = {
  delivery:    { label: "Entrega",     icon: Calendar,   bg: "bg-amber-100/60",   border: "border-amber-400/60",  dot: "bg-amber-500",   text: "text-amber-900"  },
  container:   { label: "Container",   icon: Ship,       bg: "bg-blue-100/60",    border: "border-blue-400/60",   dot: "bg-blue-500",    text: "text-blue-900"   },
  medicion:    { label: "Medición",    icon: Wrench,     bg: "bg-purple-100/60",  border: "border-purple-400/60", dot: "bg-purple-500",  text: "text-purple-900" },
  remito:      { label: "Remito",      icon: FileCheck2, bg: "bg-emerald-100/60", border: "border-emerald-400/60",dot: "bg-emerald-500", text: "text-emerald-900"},
  visita:      { label: "Visita",      icon: Building,   bg: "bg-sky-100/60",     border: "border-sky-400/60",    dot: "bg-sky-500",     text: "text-sky-900"    },
  seguimiento: { label: "Seguimiento", icon: PhoneCall,  bg: "bg-slate-100/60",   border: "border-slate-400/60",  dot: "bg-slate-500",   text: "text-slate-900"  },
  otro:        { label: "Otro",        icon: CircleDot,  bg: "bg-zinc-100/60",    border: "border-zinc-400/60",   dot: "bg-zinc-500",    text: "text-zinc-900"   },
}

function taskKindToEventKind(t: TaskType): EventKind {
  switch (t) {
    case "medicion": return "medicion"
    case "remito": return "remito"
    case "entrega": return "delivery"
    case "visita": return "visita"
    case "seguimiento": return "seguimiento"
    default: return "otro"
  }
}

export default function AgendaPage() {
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const containers = useApi<Container[]>("/api/containers").data ?? []
  const tasks = useApi<Task[]>("/api/tasks").data ?? []
  const [view, setView] = useState<View>("calendario")
  const [newOpen, setNewOpen] = useState(false)

  const events = useMemo<Event[]>(() => {
    const out: Event[] = []
    for (const s of sales) {
      // Skip cancelled sales (the entrega never happened); skip sales with no scheduled
      // delivery date (so untouched Confirmadas don't pollute the calendar on their creation day).
      // Finalizadas DO stay on the calendar — they're a historical record of what was delivered when.
      if (s.status === "Cancelado") continue
      if (!s.delivery_date) continue
      const startStr = s.delivery_date.slice(0, 10)
      const endStr   = s.delivery_date_to && s.delivery_date_to >= startStr ? s.delivery_date_to : startStr
      // Span the range — one event per day so the multi-day install is visible across cells.
      const start = new Date(startStr + "T12:00:00")
      const end   = new Date(endStr   + "T12:00:00")
      const totalDays = Math.max(1, Math.round((+end - +start) / 86400000) + 1)
      for (let i = 0; i < totalDays && i < 60; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i)
        const dStr = d.toISOString().slice(0, 10)
        out.push({
          ts: +d,
          date: dStr,
          kind: "delivery",
          title: s.title || s.client_name,
          subtitle: `${s.client_name} · ${s.status} · #${s.quote_number}${s.delivery_crew ? ` · ${s.delivery_crew}` : ""}${totalDays > 1 ? ` · día ${i + 1}/${totalDays}` : ""}`,
          meta: fmtMoney(s.contract_total),
          crew: s.delivery_crew,
          saleId: s.id,
          dayIndex: i,
          totalDays,
        })
      }
    }
    for (const c of containers) {
      if (c.status === "received") continue
      out.push({
        ts: +new Date(c.eta),
        date: c.eta,
        kind: "container",
        title: `${c.id} · ${c.vessel}`,
        subtitle: `${c.supplier} · ${c.items.length} SKUs`,
        meta: c.items.reduce((s, i) => s + i.quantity, 0).toLocaleString("es-AR") + " m²",
      })
    }
    for (const t of tasks) {
      if (t.status === "cancelada") continue
      out.push({
        ts: +new Date(t.due_date),
        date: t.due_date,
        kind: taskKindToEventKind(t.type),
        title: t.title,
        subtitle: t.notes ?? "",
        crew: t.assigned_seller,
        taskId: t.id,
        saleId: t.sale_id,
        status: t.status,
        task: t,
      })
    }
    return out.sort((a, b) => a.ts - b.ts)
  }, [sales, containers, tasks])

  return (
    <>
      <TopbarActions>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="h-8">
            <TabsTrigger value="calendario" className="gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Calendario</TabsTrigger>
            <TabsTrigger value="equipos" className="gap-1.5"><Users className="h-3.5 w-3.5" />Equipos</TabsTrigger>
            <TabsTrigger value="lista" className="gap-1.5"><List className="h-3.5 w-3.5" />Lista</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />Programar</Button>
      </TopbarActions>
      <div className="px-4 lg:px-6 space-y-3">
        {view !== "equipos" && <EventLegend />}
        {view === "calendario" ? <CalendarView events={events} sales={sales} tasks={tasks} />
          : view === "equipos" ? <TeamsView sales={sales} />
          : <ListView events={events} />}
      </div>
      <NewEventSheet open={newOpen} onOpenChange={setNewOpen} sales={sales} />
    </>
  )
}

// -----------------------------------------------------------------------------
// "+ Programar" — unified creation sheet for ad-hoc tasks/events
// -----------------------------------------------------------------------------

function NewEventSheet({ open, onOpenChange, sales }: { open: boolean; onOpenChange: (o: boolean) => void; sales: Sale[] }) {
  const settings = useApi<{ sellers?: { name: string }[]; crews?: string[] }>("/api/settings").data
  const sellers = settings?.sellers ?? []
  const crews = settings?.crews ?? []
  // Picker includes Entrega first — most common path from the agenda topbar.
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
    setType("entrega"); setTitle(""); setDate(new Date().toISOString().slice(0, 10)); setDateTo(""); setSeller(""); setSaleId(""); setNotes("")
  }, [open])

  const selectedSale = saleId ? sales.find(s => s.id === saleId) ?? null : null

  // When picking a sale for an Entrega, auto-fill the title from the client
  useEffect(() => {
    if (type !== "entrega" || !selectedSale || title) return
    setTitle(`Entrega · ${selectedSale.client_name}`)
  }, [selectedSale?.id, type])

  // Pickable sales — confirmed/programado/en proceso. For Entrega, we want sales WITHOUT a delivery_date first.
  const linkableSales = useMemo(() => sales.filter(s => ["Confirmado","Programado","En proceso"].includes(s.status)), [sales])
  const unscheduledSales = useMemo(() => linkableSales.filter(s => !s.delivery_date), [linkableSales])

  const isEntrega = type === "entrega"
  const canSubmit = !!date && (isEntrega ? !!saleId : !!title)

  const submit = async () => {
    if (!canSubmit) return
    if (isEntrega && selectedSale) {
      const isFirstSchedule = !selectedSale.delivery_date
      const effectiveTo = dateTo && dateTo >= date ? dateTo : ""
      await update.run("sales", selectedSale.id, {
        delivery_date: date,
        delivery_date_to: effectiveTo || undefined,
        delivery_crew: seller || undefined,
        delivery_notes: notes || undefined,
      })
      if (selectedSale.status === "Confirmado") await txn.run(selectedSale.id, "Programado")
      if (isFirstSchedule) {
        const now = new Date().toISOString()
        const m = new Date(date); m.setDate(m.getDate() - 2)
        await create.run("tasks", {
          type: "medicion",
          title: `Medición previa · ${selectedSale.client_name}`,
          due_date: m.toISOString().slice(0, 10),
          assigned_seller: seller || selectedSale.seller_name || undefined,
          status: "pendiente",
          sale_id: selectedSale.id,
          notes: selectedSale.client_address || "",
          created_at: now,
        })
        // Remito is created when the Medición is completed (see MedicionFormSheet).
      }
      onOpenChange(false); refresh()
      return
    }
    // Generic task path
    const r = await create.run("tasks", {
      type,
      title,
      due_date: date,
      assigned_seller: seller || undefined,
      status: "pendiente",
      sale_id: saleId || undefined,
      notes: notes || undefined,
      created_at: new Date().toISOString(),
    })
    if (r) { onOpenChange(false); refresh() }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Programar evento</SheetTitle>
          <SheetDescription>Crear una tarea o entrega en la agenda</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium block mb-1.5 uppercase tracking-wide text-muted-foreground">Tipo</label>
            <div className="grid grid-cols-2 gap-1.5">
              {PICKER.map(t => {
                const evKind = taskKindToEventKind(t)
                const st = KIND_STYLE[evKind]
                const Icon = st.icon
                const active = type === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2 py-2 text-xs transition-colors",
                      active ? `${st.border} ${st.bg} ${st.text} font-medium` : "border-border hover:bg-accent"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />{TASK_TYPE_LABEL[t]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Entrega flow: the sale picker comes first since it drives everything else */}
          {isEntrega ? (
            <>
              <div>
                <label className="text-sm font-medium block mb-1">Venta a entregar</label>
                <select value={saleId} onChange={(e) => setSaleId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="">— Elegí una venta —</option>
                  {unscheduledSales.length > 0 && (
                    <optgroup label="Sin entrega programada">
                      {unscheduledSales.map(s => <option key={s.id} value={s.id}>{saleLabel(s)} · {fmtMoney(s.contract_total)}</option>)}
                    </optgroup>
                  )}
                  {linkableSales.filter(s => s.delivery_date).length > 0 && (
                    <optgroup label="Ya programadas (reprogramar)">
                      {linkableSales.filter(s => s.delivery_date).map(s => <option key={s.id} value={s.id}>{saleLabel(s)} · {new Date(s.delivery_date!).toLocaleDateString("es-AR")}</option>)}
                    </optgroup>
                  )}
                </select>
                {selectedSale?.client_address && <div className="text-[10px] text-muted-foreground mt-1">📍 {selectedSale.client_address}</div>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium block mb-1">Entrega desde</label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Hasta <span className="text-muted-foreground font-normal">(opcional)</span></label>
                  <Input type="date" value={dateTo} min={date || undefined} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground -mt-2">Para instalaciones que duran varios días, dejá "hasta".</div>
              <div>
                <label className="text-sm font-medium block mb-1">Equipo de colocación</label>
                <select value={seller} onChange={(e) => setSeller(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="">— Sin asignar —</option>
                  {crews.map(c => <option key={c} value={c}>{c}</option>)}
                  {seller && !crews.includes(seller) && seller !== "Externo" && <option value={seller}>{seller}</option>}
                  <option value="Externo">Externo / otro</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Notas de entrega</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ascensor de carga, llaves con portero…" />
              </div>
              <div className="text-[11px] text-muted-foreground rounded-md bg-muted/40 border border-border px-3 py-2">
                Al programar se actualiza la venta a <strong>Programado</strong> y se crea la <strong>Medición previa</strong> (−2 días). El <strong>Remito</strong> se genera automáticamente al cerrar la medición.
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium block mb-1">Título</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Medición Familia Pérez / Remito Obra Pilar / …" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium block mb-1">Fecha</label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Responsable</label>
                  <select value={seller} onChange={(e) => setSeller(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                    <option value="">— Sin asignar —</option>
                    <optgroup label="Vendedores">{sellers.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}</optgroup>
                    <optgroup label="Equipos de colocación">{crews.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Venta vinculada <span className="text-muted-foreground font-normal">(opcional)</span></label>
                <select value={saleId} onChange={(e) => setSaleId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="">— Ninguna —</option>
                  {linkableSales.map(s => <option key={s.id} value={s.id}>{saleLabel(s)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Notas (opcional)</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detalles, dirección, contacto…" />
              </div>
            </>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={submit} disabled={create.busy || update.busy || txn.busy || !canSubmit}>
              {create.busy || update.busy || txn.busy ? "Guardando…" : isEntrega ? "Programar entrega" : "Programar"}
            </Button>
            {create.error && <span className="text-xs text-destructive">{create.error}</span>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function EventLegend() {
  const order: EventKind[] = ["delivery", "container", "medicion", "remito", "visita", "seguimiento"]
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-wide">Tipos:</span>
      {order.map(k => {
        const st = KIND_STYLE[k]
        return (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block h-2 w-2 rounded-full", st.dot)} />
            {st.label}
          </span>
        )
      })}
    </div>
  )
}

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1) }
function daysGrid(month: Date): { date: Date; inMonth: boolean; key: string }[] {
  const first = startOfMonth(month)
  // Convert getDay() (0=Sun..6=Sat) to Monday-first (0=Mon..6=Sun)
  const firstDow = (first.getDay() + 6) % 7
  const start = new Date(first); start.setDate(first.getDate() - firstDow)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i)
    return { date: d, inMonth: d.getMonth() === month.getMonth(), key: d.toISOString().slice(0, 10) }
  })
}

function CalendarView({ events, sales, tasks }: { events: Event[]; sales: Sale[]; tasks: Task[] }) {
  const today = new Date(); today.setHours(0,0,0,0)
  const [cursor, setCursor] = useState(startOfMonth(today))
  const [focused, setFocused] = useState<string | null>(null)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)
  const [medicionTask, setMedicionTask] = useState<Task | null>(null)
  const [informeTask, setInformeTask] = useState<Task | null>(null)
  const update = useAction(api.update)

  const eventsByDate = useMemo(() => {
    const m = new Map<string, Event[]>()
    for (const e of events) {
      const k = e.date.slice(0, 10)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(e)
    }
    return m
  }, [events])

  // Carriles: cada evento (rango multi-día o suelto) ocupa la MISMA fila en todos
  // los días que toca, así los rangos se ven contiguos y no "partidos".
  const laneByDate = useMemo(() => {
    const groupKey = (e: Event) => e.saleId ? `s:${e.saleId}` : e.taskId ? `t:${e.taskId}` : `x:${e.date.slice(0, 10)}:${e.kind}:${e.title}`
    const groups = new Map<string, { key: string; start: string; end: string; byDate: Map<string, Event> }>()
    for (const e of events) {
      const dk = e.date.slice(0, 10), gk = groupKey(e)
      let g = groups.get(gk)
      if (!g) { g = { key: gk, start: dk, end: dk, byDate: new Map() }; groups.set(gk, g) }
      g.byDate.set(dk, e)
      if (dk < g.start) g.start = dk
      if (dk > g.end) g.end = dk
    }
    const sorted = [...groups.values()].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end))
    const laneEnds: string[] = []
    const laneOf = new Map<string, number>()
    for (const g of sorted) {
      let lane = 0
      while (lane < laneEnds.length && laneEnds[lane] >= g.start) lane++
      laneEnds[lane] = g.end
      laneOf.set(g.key, lane)
    }
    // Por fecha: array de carriles (índice = lane) con el evento de ese día (o undefined).
    const laneByDate = new Map<string, (Event | undefined)[]>()
    for (const g of groups.values()) {
      const lane = laneOf.get(g.key)!
      for (const [dk, e] of g.byDate) {
        if (!laneByDate.has(dk)) laneByDate.set(dk, [])
        laneByDate.get(dk)![lane] = e
      }
    }
    return laneByDate
  }, [events])

  const cells = useMemo(() => daysGrid(cursor), [cursor])
  const monthLabel = cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" })

  const focusedEvents = focused ? eventsByDate.get(focused) ?? [] : []

  // Containers have external ETAs and aren't draggable
  const isDraggable = (e: Event) => e.kind !== "container"

  const handleDrop = async (date: string, e: React.DragEvent) => {
    e.preventDefault()
    setDragOverDate(null); setDraggingKey(null)
    const payload = e.dataTransfer.getData("text/event")
    if (!payload) return
    let data: { action?: "move" | "resize-end"; kind: string; saleId?: string; taskId?: string; fromDate: string; dayIndex?: number }
    try { data = JSON.parse(payload) } catch { return }

    // Resize the END of a delivery range — keeps start where it is, sets delivery_date_to to the drop date.
    if (data.action === "resize-end" && data.saleId) {
      const sale = sales.find(s => s.id === data.saleId)
      if (!sale || !sale.delivery_date) return
      const start = sale.delivery_date.slice(0, 10)
      if (date < start) return  // cannot end before start
      const r = await update.run("sales", data.saleId, {
        delivery_date_to: date === start ? undefined : date,
      })
      if (r) refresh()
      return
    }

    if (data.fromDate === date) return
    if (data.kind === "delivery" && data.saleId) {
      const sale = sales.find(s => s.id === data.saleId)
      const offset = data.dayIndex ?? 0
      const newStart = new Date(date + "T12:00:00"); newStart.setDate(newStart.getDate() - offset)
      const totalDays = sale?.delivery_date && sale.delivery_date_to
        ? Math.max(1, Math.round((+new Date(sale.delivery_date_to + "T12:00:00") - +new Date(sale.delivery_date + "T12:00:00")) / 86400000) + 1)
        : 1
      const newEnd = new Date(newStart); newEnd.setDate(newStart.getDate() + totalDays - 1)
      const startStr = newStart.toISOString().slice(0, 10)
      const endStr   = newEnd.toISOString().slice(0, 10)
      const r = await update.run("sales", data.saleId, {
        delivery_date: startStr,
        delivery_date_to: totalDays > 1 ? endStr : undefined,
      })
      if (r) refresh()
    } else if (data.taskId) {
      const r = await update.run("tasks", data.taskId, { due_date: date })
      if (r) refresh()
    }
  }

  return (
    <Card className="p-0 overflow-hidden gap-0">
      <div className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border">
        <div>
          <div className="text-base font-medium capitalize serif">{monthLabel}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setCursor(addMonths(cursor, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(startOfMonth(new Date()))} className="h-8">Hoy</Button>
          <Button variant="ghost" size="icon" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {WEEKDAYS.map((w) => <div key={w} className="px-2 py-2 text-[11px] uppercase tracking-wide text-muted-foreground font-medium border-r border-border last:border-r-0">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {cells.map((c, i) => {
          const isToday = c.date.getTime() === today.getTime()
          const list = eventsByDate.get(c.key) ?? []
          const isDropTarget = draggingKey != null && dragOverDate === c.key
          return (
            <button
              type="button"
              key={c.key + i}
              onClick={() => list.length > 0 && setFocused(c.key)}
              onDragOver={(e) => { if (draggingKey) { e.preventDefault(); setDragOverDate(c.key) } }}
              onDragLeave={() => setDragOverDate(prev => prev === c.key ? null : prev)}
              onDrop={(e) => handleDrop(c.key, e)}
              className={cn(
                "relative text-left min-h-[100px] p-2 border-r border-b border-border last:border-r-0 [&:nth-child(7n)]:border-r-0 transition-colors",
                !c.inMonth && "bg-muted/20 text-muted-foreground",
                list.length > 0 && "hover:bg-accent cursor-pointer",
                list.length === 0 && "cursor-default",
                isDropTarget && "ring-2 ring-primary ring-inset bg-primary/5"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={cn(
                  "text-xs tabular",
                  isToday && "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground font-medium",
                  !isToday && !c.inMonth && "text-muted-foreground/60",
                )}>{c.date.getDate()}</span>
                {list.length > 0 && <span className="text-[10px] text-muted-foreground">{list.length}</span>}
              </div>
              <div className="flex flex-col gap-1">
                {(() => {
                const MAX = 4
                const cellLanes = (laneByDate.get(c.key) ?? []).slice(0, MAX)
                let shownCount = 0
                const nodes = cellLanes.map((e, lane) => {
                  if (!e) return <div key={`sp-${lane}`} className="h-5" aria-hidden />
                  shownCount++
                  const st = KIND_STYLE[e.kind]
                  const Icon = st.icon
                  const evKey = e.taskId ?? e.saleId ?? `${e.date}-${lane}`
                  const canDrag = isDraggable(e)
                  // Multi-day delivery range — render each day as a connected segment
                  const isRange = e.kind === "delivery" && (e.totalDays ?? 1) > 1
                  const isFirst = isRange && e.dayIndex === 0
                  const isLast  = isRange && e.dayIndex === (e.totalDays ?? 1) - 1
                  const isMiddle = isRange && !isFirst && !isLast
                  const showResize = e.kind === "delivery" && e.saleId && (isLast || !isRange)
                  return (
                    <div
                      key={lane}
                      draggable={canDrag}
                      onDragStart={(ev) => {
                        if (!canDrag) return
                        ev.stopPropagation()
                        ev.dataTransfer.setData("text/event", JSON.stringify({ action: "move", kind: e.kind, saleId: e.saleId, taskId: e.taskId, fromDate: c.key, dayIndex: e.dayIndex ?? 0 }))
                        ev.dataTransfer.effectAllowed = "move"
                        setDraggingKey(evKey)
                      }}
                      onDragEnd={() => { setDraggingKey(null); setDragOverDate(null) }}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        if (e.task && e.kind === "medicion") setMedicionTask(e.task)
                        else if (e.task && e.kind === "remito") setInformeTask(e.task)
                      }}
                      className={cn(
                        "text-[10px] truncate h-5 leading-none border flex items-center gap-1 relative z-10",
                        st.bg, st.border, st.text,
                        canDrag && "cursor-grab active:cursor-grabbing",
                        draggingKey === evKey && "opacity-50 ring-1 ring-primary",
                        // Single-day default
                        !isRange && "rounded px-1.5",
                        // Multi-day connected styling — overlap 1px past cell padding to hide the cell border seam
                        isFirst  && "rounded-l-md pl-1.5 pr-1 -mr-[9px] border-r-0",
                        isMiddle && "px-1.5 -mx-[9px] border-l-0 border-r-0",
                        isLast   && "rounded-r-md pl-1 pr-1.5 -ml-[9px] border-l-0",
                      )}
                      title={isRange ? `Día ${(e.dayIndex ?? 0) + 1} de ${e.totalDays} · Arrastrá para mover · grippy para extender` : canDrag ? "Arrastrá para reprogramar" : "Container — ETA externa, no editable"}
                    >
                      {(!isRange || isFirst) && <Icon className="h-2.5 w-2.5 shrink-0" />}
                      {(!isRange || isFirst) && <span className="truncate">{e.title}</span>}
                      {isMiddle && <span className="truncate opacity-60">·</span>}
                      {isLast && <span className="truncate opacity-60">·</span>}
                      {showResize && (
                        <span
                          draggable
                          onDragStart={(ev) => {
                            ev.stopPropagation()
                            ev.dataTransfer.setData("text/event", JSON.stringify({ action: "resize-end", kind: "delivery", saleId: e.saleId, fromDate: c.key }))
                            ev.dataTransfer.effectAllowed = "move"
                            setDraggingKey(evKey + ":resize")
                          }}
                          onDragEnd={() => { setDraggingKey(null); setDragOverDate(null) }}
                          onClick={(ev) => ev.stopPropagation()}
                          className={cn("ml-auto -mr-0.5 px-0.5 rounded cursor-ew-resize opacity-60 hover:opacity-100 hover:bg-black/10")}
                          title="Arrastrá para extender el rango (hasta)"
                        >
                          <GripVertical className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </div>
                  )
                })
                const hidden = list.length - shownCount
                return <>{nodes}{hidden > 0 && <div className="text-[10px] text-muted-foreground px-1.5">+{hidden} más</div>}</>
                })()}
              </div>
            </button>
          )
        })}
      </div>

      <Sheet open={!!focused} onOpenChange={(o) => !o && setFocused(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{focused ? new Date(focused + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""}</SheetTitle>
            <SheetDescription>{focusedEvents.length} evento{focusedEvents.length === 1 ? "" : "s"}</SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-3">
            {focusedEvents.map((e, i) => {
              const st = KIND_STYLE[e.kind]
              const Icon = st.icon
              return (
                <div key={i} className={cn("border rounded-md p-3", st.border)}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={cn("h-4 w-4", st.text)} />
                    <span className="font-medium">{e.title}</span>
                    <Badge variant="outline" className={cn("text-[10px]", st.text)}>{st.label}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{e.subtitle}</div>
                  {e.crew && <div className="text-xs text-muted-foreground mt-1">Equipo: {e.crew}</div>}
                  {e.meta && <div className="text-xs tabular text-muted-foreground mt-1">{e.meta}</div>}
                </div>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>

      <MedicionFormSheet task={medicionTask} sale={medicionTask?.sale_id ? sales.find(s => s.id === medicionTask.sale_id) ?? null : null} allTasks={tasks} onClose={() => setMedicionTask(null)} />
      <InformeFormSheet task={informeTask} sale={informeTask?.sale_id ? sales.find(s => s.id === informeTask.sale_id) ?? null : null} onClose={() => setInformeTask(null)} />
    </Card>
  )
}

// -----------------------------------------------------------------------------
// TeamsView — disponibilidad semanal de equipos de colocación
// -----------------------------------------------------------------------------
function startOfWeek(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x }
function TeamsView({ sales }: { sales: Sale[] }) {
  const settings = useApi<{ crews?: string[] }>("/api/settings").data
  const crews = settings?.crews ?? []
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [weekStart, setWeekStart] = useState(startOfWeek(today))
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d }), [weekStart])
  const dayKey = (d: Date) => d.toISOString().slice(0, 10)
  const weekFrom = dayKey(days[0]), weekTo = dayKey(days[6])

  // Filas: equipos definidos + un "Sin asignar / Externo" para colocaciones sin equipo de la lista.
  const rows = useMemo(() => [...crews, "Sin asignar / Externo"], [crews])
  const rowFor = (s: Sale) => (s.delivery_crew && crews.includes(s.delivery_crew)) ? s.delivery_crew : "Sin asignar / Externo"

  // Colocaciones (ventas con entrega) que tocan esta semana.
  const placements = useMemo(() => sales.filter(s => {
    if (!s.delivery_date) return false
    const from = s.delivery_date.slice(0, 10)
    const to = (s.delivery_date_to && s.delivery_date_to >= from ? s.delivery_date_to : from).slice(0, 10)
    return from <= weekTo && to >= weekFrom
  }), [sales, weekFrom, weekTo])

  const cellSales = (crew: string, d: Date) => {
    const k = dayKey(d)
    return placements.filter(s => {
      if (rowFor(s) !== crew) return false
      const from = s.delivery_date!.slice(0, 10)
      const to = (s.delivery_date_to && s.delivery_date_to >= from ? s.delivery_date_to : from).slice(0, 10)
      return from <= k && k <= to
    })
  }
  const busyDays = (crew: string) => days.filter(d => cellSales(crew, d).length > 0).length
  const isWeekend = (d: Date) => { const w = d.getDay(); return w === 0 || w === 6 }
  const label = days[0].toLocaleDateString("es-AR", { day: "numeric", month: "short" }) + " – " + days[6].toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })

  return (
    <Card className="p-0 overflow-hidden gap-0">
      <div className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border">
        <div className="text-base font-medium capitalize serif">Semana {label}</div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(d => { const x = new Date(d); x.setDate(x.getDate() - 7); return x })}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))} className="h-8">Esta semana</Button>
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(d => { const x = new Date(d); x.setDate(x.getDate() + 7); return x })}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          {/* Header de días */}
          <div className="grid border-b border-border bg-muted/40" style={{ gridTemplateColumns: "150px repeat(7, 1fr)" }}>
            <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground font-medium border-r border-border">Equipo</div>
            {days.map((d, i) => (
              <div key={i} className={cn("px-2 py-2 text-[11px] border-r border-border last:border-r-0", isWeekend(d) && "bg-muted/30")}>
                <div className="uppercase tracking-wide text-muted-foreground">{WEEKDAYS[i]}</div>
                <div className={cn("tabular", d.getTime() === today.getTime() ? "font-semibold text-foreground" : "text-muted-foreground")}>{d.getDate()}</div>
              </div>
            ))}
          </div>
          {/* Filas de equipos */}
          {rows.map((crew, ri) => {
            const busy = busyDays(crew)
            const isUnassigned = crew === "Sin asignar / Externo"
            return (
              <div key={ri} className="grid border-b border-border last:border-b-0" style={{ gridTemplateColumns: "150px repeat(7, 1fr)" }}>
                <div className="px-3 py-2 border-r border-border flex flex-col justify-center">
                  <div className={cn("text-sm font-medium truncate", isUnassigned && "text-muted-foreground")}>{crew}</div>
                  {!isUnassigned && (
                    <div className="text-[10px] text-muted-foreground">{busy === 0 ? "libre toda la semana" : `${busy}/7 días ocupado · ${7 - busy} libre${7 - busy === 1 ? "" : "s"}`}</div>
                  )}
                </div>
                {days.map((d, di) => {
                  const list = cellSales(crew, d)
                  return (
                    <div key={di} className={cn("min-h-[60px] p-1.5 border-r border-border last:border-r-0 space-y-1", isWeekend(d) && "bg-muted/20", list.length === 0 && !isUnassigned && !isWeekend(d) && "bg-emerald-50/40")}>
                      {list.map(s => (
                        <div key={s.id} className="text-[10px] rounded bg-amber-100/70 border border-amber-300/60 text-amber-900 px-1.5 py-1 leading-tight" title={`${saleLabel(s)}${s.client_address ? " · " + s.client_address : ""}`}>
                          <div className="font-medium truncate">{s.title || s.client_name}</div>
                          <div className="truncate opacity-70">{s.client_name}</div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <div className="px-4 lg:px-6 py-2.5 border-t border-border text-[11px] text-muted-foreground">
        Verde = día libre del equipo. Asigná el equipo desde la venta o al programar la entrega.
      </div>
    </Card>
  )
}

// ---- Registrar medición ---------------------------------------------------
type ExtraRow = { description: string; quantity: number; sku?: string }

function MedicionFormSheet({ task, sale, allTasks, onClose }: { task: Task | null; sale: Sale | null; allTasks: Task[]; onClose: () => void }) {
  const [m2, setM2] = useState<number>(0)
  const [superficie, setSuperficie] = useState<string>("Contrapiso nuevo")
  const [observaciones, setObservaciones] = useState<string>("")
  const [extrasItems, setExtrasItems] = useState<ExtraRow[]>([])
  const [markDone, setMarkDone] = useState<boolean>(true)
  const update = useAction(api.update)
  const create = useAction(api.create)

  // Snapshot of what was quoted, so the vendor can compare on-site reality vs cotización.
  const quotedTotalM2 = (sale?.items ?? []).reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)

  useEffect(() => {
    if (!task) return
    const d = task.medicion_data ?? {}
    // Prefill m² medidos with what was quoted on first open — vendor adjusts only if reality differs.
    setM2(d.m2_medidos ?? quotedTotalM2 ?? 0)
    setSuperficie(d.superficie ?? "Contrapiso nuevo")
    setObservaciones(d.observaciones ?? "")
    setExtrasItems(d.extras_items ?? (d.extras ? [{ description: d.extras, quantity: 1 }] : []))
    setMarkDone(task.status !== "completada")
  }, [task?.id])

  if (!task) return null

  const addExtra    = () => setExtrasItems(prev => [...prev, { description: "", quantity: 1 }])
  const updateExtra = (i: number, patch: Partial<ExtraRow>) => setExtrasItems(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const removeExtra = (i: number) => setExtrasItems(prev => prev.filter((_, idx) => idx !== i))

  const diff = m2 - quotedTotalM2
  const diffPct = quotedTotalM2 > 0 ? (diff / quotedTotalM2) * 100 : 0

  const submit = async () => {
    const cleanExtras = extrasItems.filter(x => (x.description ?? "").trim() && (Number(x.quantity) || 0) > 0)
    const payload = {
      m2_medidos: m2 || undefined,
      m2_cotizados: quotedTotalM2 || undefined,
      superficie,
      observaciones: observaciones || undefined,
      extras_items: cleanExtras.length > 0 ? cleanExtras : undefined,
      recorded_at: new Date().toISOString(),
      recorded_by: task.assigned_seller,
    }
    await update.run("tasks", task.id, {
      medicion_data: payload,
      status: markDone ? "completada" : task.status,
      completed_at: markDone ? new Date().toISOString() : undefined,
    })
    if (sale) await update.run("sales", sale.id, { medicion_data: payload })

    if (markDone && sale && sale.delivery_date) {
      const existingRemito = allTasks.find(t => t.type === "remito" && t.sale_id === sale.id && t.status !== "cancelada")
      if (!existingRemito) {
        await create.run("tasks", {
          type: "remito",
          title: `Remito · ${sale.client_name}`,
          due_date: sale.delivery_date_to || sale.delivery_date.slice(0, 10),
          assigned_seller: task.assigned_seller || sale.seller_name || undefined,
          status: "pendiente",
          sale_id: sale.id,
          notes: sale.client_address || "",
          created_at: new Date().toISOString(),
        })
      }
    }
    onClose(); refresh()
  }
  return (
    <Sheet open={!!task} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Registrar medición</SheetTitle>
          <SheetDescription>{task.title}{sale ? ` · ${sale.client_address ?? ""}` : ""}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          {sale && (
            <div className="rounded-md border border-border p-3 bg-muted/40 text-xs space-y-0.5">
              <div className="font-medium text-sm">{sale.client_name}</div>
              {sale.client_address && <div className="text-muted-foreground">📍 {sale.client_address}</div>}
              <div className="text-muted-foreground">Venta #{sale.quote_number} · {fmtMoney(sale.contract_total)}</div>
            </div>
          )}

          {/* Items quoted — snapshot to compare against the on-site reality */}
          {(sale?.items?.length ?? 0) > 0 && (
            <div className="rounded-md border border-border">
              <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Items cotizados</div>
                <div className="text-[10px] text-muted-foreground tabular">{quotedTotalM2} m² total</div>
              </div>
              <div className="divide-y divide-border max-h-40 overflow-y-auto">
                {sale!.items.map((it, i) => (
                  <div key={i} className="px-3 py-1.5 flex items-center justify-between text-xs gap-2">
                    <div className="min-w-0">
                      <div className="truncate">{it.description}</div>
                      <div className="text-[10px] text-muted-foreground">{it.sku}</div>
                    </div>
                    <div className="tabular text-muted-foreground shrink-0">{it.quantity}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* m² with side-by-side comparison */}
          <div>
            <label className="text-sm font-medium block mb-1">m² medidos en obra</label>
            <Input type="number" step="0.1" min={0} value={m2} onChange={(e) => setM2(Number(e.target.value) || 0)} />
            {quotedTotalM2 > 0 && (
              <div className="text-[11px] mt-1 tabular">
                Cotizado: <span className="text-foreground">{quotedTotalM2}</span> ·
                {" "}Medido: <span className="text-foreground">{m2 || "—"}</span>
                {m2 > 0 && (
                  <span className={cn(
                    "ml-1 font-medium",
                    Math.abs(diff) < 0.5 ? "text-muted-foreground" :
                    diff > 0 ? "text-amber-700" : "text-blue-700"
                  )}>
                    · {diff > 0 ? "+" : ""}{diff.toFixed(1)} m² ({diffPct >= 0 ? "+" : ""}{diffPct.toFixed(1)}%)
                    {Math.abs(diff) >= 0.5 && (diff > 0 ? " — más superficie de la cotizada" : " — menos superficie de la cotizada")}
                  </span>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Tipo de superficie</label>
            <select value={superficie} onChange={(e) => setSuperficie(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              <option>Contrapiso nuevo</option>
              <option>Contrapiso existente</option>
              <option>Piso de madera existente</option>
              <option>Cemento alisado</option>
              <option>Cerámico (a remover)</option>
              <option>Otro</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Observaciones</label>
            <Input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Nivelación, humedad, escalones, etc." />
          </div>

          {/* Extras detected on site — structured list */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium">Extras detectados</label>
              <button type="button" onClick={addExtra} className="text-xs text-primary hover:underline inline-flex items-center gap-1"><Plus className="h-3 w-3" />Agregar</button>
            </div>
            {extrasItems.length === 0 ? (
              <div className="text-[11px] text-muted-foreground italic border border-dashed border-border rounded-md p-2 text-center">
                Sin extras. Agregá zócalos, narices de balconeo, ajustes, etc. detectados en obra.
              </div>
            ) : (
              <div className="space-y-2">
                {extrasItems.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_72px_28px] gap-1.5 items-center">
                    <Input value={row.description} onChange={(e) => updateExtra(i, { description: e.target.value })} placeholder="Descripción del extra" className="h-8 text-xs" />
                    <Input type="number" step="0.1" min={0} value={row.quantity} onChange={(e) => updateExtra(i, { quantity: Number(e.target.value) || 0 })} className="h-8 text-xs" />
                    <button type="button" onClick={() => removeExtra(i)} className="h-8 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-destructive" aria-label="Quitar extra">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground mt-1">Los extras se guardan en la medición y aparecen en el Remito para que puedas ajustar la facturación.</div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} />
            Marcar la medición como completada
          </label>
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={submit} disabled={update.busy}>{update.busy ? "Guardando…" : "Guardar medición"}</Button>
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
          </div>
          <div className="text-[11px] text-muted-foreground">Al guardar la medición se crea automáticamente el Remito el día de la entrega (con los datos pre-llenados).</div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ---- Remito (post-delivery closure, prefilled from medición) --------------
function InformeFormSheet({ task, sale, onClose }: { task: Task | null; sale: Sale | null; onClose: () => void }) {
  const [observaciones, setObservaciones] = useState<string>("")
  const [m2Entregados, setM2Entregados] = useState<number>(0)
  const [conformidad, setConformidad] = useState<boolean>(true)
  const update = useAction(api.update)
  const txn = useAction(api.saleTransition)

  // Prefill once on open from the linked sale's medicion_data
  useEffect(() => {
    if (!task) return
    const md = sale?.medicion_data
    setObservaciones(md?.observaciones ?? task.notes ?? "")
    setM2Entregados(md?.m2_medidos ?? 0)
    setConformidad(true)
  }, [task?.id, sale?.id])

  if (!task) return null
  const submit = async () => {
    await update.run("tasks", task.id, {
      status: "completada",
      completed_at: new Date().toISOString(),
      notes: [`m² entregados: ${m2Entregados}`, `Conformidad: ${conformidad ? "Sí" : "No"}`, observaciones].filter(Boolean).join(" · "),
    })
    // Finalize the linked sale when conformidad is true — this also deducts stock via the state machine
    if (sale && conformidad && sale.status !== "Finalizado") await txn.run(sale.id, "Finalizado")
    onClose(); refresh()
  }
  const md = sale?.medicion_data
  return (
    <Sheet open={!!task} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Remito</SheetTitle>
          <SheetDescription>{task.title}{sale ? ` · ${sale.client_address ?? ""}` : ""}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          {sale && (
            <div className="rounded-md border border-border p-3 bg-muted/40 text-xs space-y-0.5">
              <div className="font-medium text-sm">{sale.client_name}</div>
              <div className="text-muted-foreground">Venta #{sale.quote_number} · {fmtMoney(sale.contract_total)}</div>
              {sale.delivery_date && <div className="text-muted-foreground">Entrega: {new Date(sale.delivery_date).toLocaleDateString("es-AR")}</div>}
            </div>
          )}
          {md ? (
            <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 p-3 text-xs space-y-0.5">
              <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400 font-medium">Datos de medición previa</div>
              {md.m2_medidos != null && <div>m² medidos: <span className="tabular">{md.m2_medidos}</span>{md.m2_cotizados != null && <span className="text-muted-foreground"> · cotizado {md.m2_cotizados}</span>}</div>}
              {md.superficie && <div>Superficie: {md.superficie}</div>}
              {md.observaciones && <div>Obs: {md.observaciones}</div>}
              {md.extras_items && md.extras_items.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mt-1.5">Extras detectados</div>
                  <ul className="list-disc list-inside">
                    {md.extras_items.map((x, i) => <li key={i}>{x.description} <span className="tabular text-muted-foreground">× {x.quantity}</span></li>)}
                  </ul>
                </div>
              )}
              {!md.extras_items && md.extras && <div>Extras: {md.extras}</div>}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground italic">Sin datos de medición previa — completá manualmente.</div>
          )}
          <div>
            <label className="text-sm font-medium block mb-1">m² efectivamente entregados</label>
            <Input type="number" step="0.1" min={0} value={m2Entregados} onChange={(e) => setM2Entregados(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Observaciones de cierre</label>
            <Input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Detalles de la entrega/instalación" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={conformidad} onChange={(e) => setConformidad(e.target.checked)} />
            Cliente firmó conformidad — finalizar venta (descontar stock)
          </label>
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={submit} disabled={update.busy || txn.busy}>{update.busy || txn.busy ? "Guardando…" : "Cerrar remito"}</Button>
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ListView({ events }: { events: Event[] }) {
  const grouped = useMemo(() => {
    const m = new Map<string, Event[]>()
    for (const e of events) {
      const k = e.date.slice(0, 10)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(e)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [events])

  return (
    <div className="space-y-3">
      {grouped.length === 0 ? (
        <Card className="px-6 py-10 text-center text-muted-foreground">No hay eventos próximos.</Card>
      ) : grouped.map(([date, items]) => (
        <Card key={date}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {new Date(date + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </CardTitle>
            <CardDescription>{items.length} evento{items.length === 1 ? "" : "s"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.map((e, i) => {
              const st = KIND_STYLE[e.kind]
              const Icon = st.icon
              return (
                <div key={i} className="flex items-start gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <div className={cn("mt-0.5", st.text)}><Icon className="h-4 w-4" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{e.title}</span>
                      <Badge variant="outline" className={cn("text-[10px]", st.text)}>{st.label}</Badge>
                      {e.crew && <span className="text-[10px] text-muted-foreground">· {e.crew}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">{e.subtitle}</div>
                  </div>
                  {e.meta ? <div className="text-sm tabular text-muted-foreground shrink-0">{e.meta}</div> : null}
                </div>
              )
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
