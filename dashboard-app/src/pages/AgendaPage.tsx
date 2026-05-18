import { useMemo, useState } from "react"
import { Calendar, Ship, ChevronLeft, ChevronRight, List, CalendarDays } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { useApi } from "@/lib/api"
import { fmtMoney } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import type { Sale, Container } from "@/lib/types"

type Event = { ts: number; date: string; kind: "delivery" | "container"; title: string; subtitle: string; meta?: string }
type View = "lista" | "calendario"

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

export default function AgendaPage() {
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const containers = useApi<Container[]>("/api/containers").data ?? []
  const [view, setView] = useState<View>("calendario")

  const events = useMemo<Event[]>(() => {
    const out: Event[] = []
    for (const s of sales) {
      if (s.stock_deducted) continue
      if (!["Confirmado","Programado","En proceso"].includes(s.status)) continue
      const date = s.delivery_date || s.created_at.slice(0, 10)
      out.push({
        ts: +new Date(date),
        date,
        kind: "delivery",
        title: s.client_name,
        subtitle: `${s.status} · #${s.quote_number} · ${s.description}`,
        meta: fmtMoney(s.contract_total),
      })
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
    return out.sort((a, b) => a.ts - b.ts)
  }, [sales, containers])

  return (
    <>
      <TopbarActions>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="h-8">
            <TabsTrigger value="calendario" className="gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Calendario</TabsTrigger>
            <TabsTrigger value="lista" className="gap-1.5"><List className="h-3.5 w-3.5" />Lista</TabsTrigger>
          </TabsList>
        </Tabs>
      </TopbarActions>
      <div className="px-4 lg:px-6">
        {view === "calendario" ? <CalendarView events={events} /> : <ListView events={events} />}
      </div>
    </>
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

function CalendarView({ events }: { events: Event[] }) {
  const today = new Date(); today.setHours(0,0,0,0)
  const [cursor, setCursor] = useState(startOfMonth(today))
  const [focused, setFocused] = useState<string | null>(null)

  const eventsByDate = useMemo(() => {
    const m = new Map<string, Event[]>()
    for (const e of events) {
      const k = e.date.slice(0, 10)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(e)
    }
    return m
  }, [events])

  const cells = useMemo(() => daysGrid(cursor), [cursor])
  const monthLabel = cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" })

  const focusedEvents = focused ? eventsByDate.get(focused) ?? [] : []

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
          return (
            <button
              type="button"
              key={c.key + i}
              onClick={() => list.length > 0 && setFocused(c.key)}
              className={cn(
                "relative text-left min-h-[100px] p-2 border-r border-b border-border last:border-r-0 [&:nth-child(7n)]:border-r-0 transition-colors",
                !c.inMonth && "bg-muted/20 text-muted-foreground",
                list.length > 0 && "hover:bg-accent cursor-pointer",
                list.length === 0 && "cursor-default"
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
                {list.slice(0, 3).map((e, k) => (
                  <div key={k} className="text-[10px] truncate px-1.5 py-0.5 rounded border border-border bg-card flex items-center gap-1">
                    {e.kind === "container" ? <Ship className="h-2.5 w-2.5 shrink-0" /> : <Calendar className="h-2.5 w-2.5 shrink-0" />}
                    <span className="truncate">{e.title}</span>
                  </div>
                ))}
                {list.length > 3 && <div className="text-[10px] text-muted-foreground px-1.5">+{list.length - 3} más</div>}
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
            {focusedEvents.map((e, i) => (
              <div key={i} className="border border-border rounded-md p-3">
                <div className="flex items-center gap-2 mb-1">
                  {e.kind === "container" ? <Ship className="h-4 w-4" /> : <Calendar className="h-4 w-4" />}
                  <span className="font-medium">{e.title}</span>
                  <Badge variant="outline" className="text-[10px]">{e.kind === "container" ? "Container" : "Entrega"}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{e.subtitle}</div>
                {e.meta && <div className="text-xs tabular text-muted-foreground mt-1">{e.meta}</div>}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </Card>
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
            {items.map((e, i) => (
              <div key={i} className="flex items-start gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
                <div className="mt-0.5 text-muted-foreground">{e.kind === "container" ? <Ship className="h-4 w-4" /> : <Calendar className="h-4 w-4" />}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="font-medium truncate">{e.title}</span><Badge variant="outline" className="text-[10px]">{e.kind === "container" ? "Container" : "Entrega"}</Badge></div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">{e.subtitle}</div>
                </div>
                {e.meta ? <div className="text-sm tabular text-muted-foreground shrink-0">{e.meta}</div> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
