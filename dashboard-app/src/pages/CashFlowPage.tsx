import { useMemo, useState } from "react"
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, AlertTriangle } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import { CashflowForm } from "@/components/forms/CashflowForm"
import { useApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { CashflowMovement, Caja } from "@/lib/types"

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
const selectCls =
  "h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

const money = (n: number) =>
  n ? (n < 0 ? "-$ " : "$ ") + Math.abs(Math.round(n)).toLocaleString("es-AR") : "—"
const pct = (n: number) => (isFinite(n) ? (n * 100).toFixed(1) + "%" : "—")
const fmtDate = (s: string | null) => (s ? s.slice(0, 10) : "—")

// ---- P&L line classification (mirrors the legacy statement) ----
const REVENUE = ["Paneles", "Reparaciones", "Pisos", "Otros ingresos"]
const COGS_LINES = ["COGS", "Gastos de Instalaciones y Suministros"]
const OPEX = ["Gastos Administrativos", "Gastos de Personal (HR y Mano de Obra)", "Marketing y Ventas", "Gastos de Flota/Vehículos", "Depreciación y Amortización"]
const BELOW = ["Impuestos y Tasas", "Otros Gastos y Ajustes"]

function plLine(m: CashflowMovement): string {
  if (m.flow === "Ingreso") {
    const cp = (m.counterparty ?? "").toUpperCase()
    if (m.category === "Venta - Pisos") return "Pisos"
    if (cp.includes("PANEL")) return "Paneles"
    if (cp.includes("REPARAC")) return "Reparaciones"
    return "Otros ingresos"
  }
  if ((m.category ?? "").includes("Otros Gastos")) return "Otros Gastos y Ajustes"
  return m.expense_type || "Otros Gastos y Ajustes"
}

// Dimensión principal del libro: Tipo de Gasto (egresos) o rubro de venta (ingresos).
const rubroOf = (m: CashflowMovement) => (m.flow === "Egreso" ? (m.expense_type || m.category) : m.category) || "—"

// Período dinámico → rango [from, to] en YYYY-MM-DD.
type Range = { from: string; to: string }
const PRESETS: { key: string; label: string }[] = [
  { key: "m3", label: "Últimos 3 meses" }, { key: "m6", label: "Últimos 6 meses" },
  { key: "m12", label: "Últimos 12 meses" }, { key: "ytd", label: "Este año" },
  { key: "all", label: "Todo" }, { key: "custom", label: "Rango…" },
]
function computeRange(preset: string, movements: CashflowMovement[], cFrom: string, cTo: string): Range {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const days = movements.map((m) => m.date?.slice(0, 10)).filter(Boolean).sort() as string[]
  const minD = days[0] ?? "2024-01-01", maxD = days[days.length - 1] ?? iso(new Date())
  const now = new Date()
  const backMonths = (n: number) => { const d = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1); return iso(d) }
  switch (preset) {
    case "m3": return { from: backMonths(3), to: maxD }
    case "m6": return { from: backMonths(6), to: maxD }
    case "m12": return { from: backMonths(12), to: maxD }
    case "ytd": return { from: iso(new Date(now.getFullYear(), 0, 1)), to: maxD }
    case "custom": return { from: cFrom || minD, to: cTo || maxD }
    default: return { from: minD, to: maxD }
  }
}

export default function CashFlowPage() {
  const movements = useApi<CashflowMovement[]>("/api/cashflow").data ?? []
  const cajas = useApi<Caja[]>("/api/cajas").data ?? []

  const [preset, setPreset] = useState("m12")
  const [cFrom, setCFrom] = useState("")
  const [cTo, setCTo] = useState("")
  const range = useMemo(() => computeRange(preset, movements, cFrom, cTo), [preset, movements, cFrom, cTo])
  const [openNew, setOpenNew] = useState(false)

  return (
    <div className="px-4 lg:px-6 space-y-4">
      <TopbarActions>
        <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" />Nuevo movimiento</Button>
      </TopbarActions>
      <CashflowForm open={openNew} onOpenChange={setOpenNew} cajas={cajas} />
      <p className="text-xs text-muted-foreground">Análisis financiero: resultado, estructura de gastos y libro completo (ingresos + egresos). Para cargar egresos del día a día usá <b>Gastos y Pagos</b>.</p>
      <Tabs defaultValue="pnl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="h-8">
            <TabsTrigger value="pnl">Estado de Resultados</TabsTrigger>
            <TabsTrigger value="gastos">Gastos (Fijo/Variable)</TabsTrigger>
            <TabsTrigger value="libro">Libro</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 flex-wrap">
            <select className={selectCls} value={preset} onChange={(e) => setPreset(e.target.value)}>
              {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            {preset === "custom" && (
              <>
                <input type="date" className={selectCls} value={cFrom} onChange={(e) => setCFrom(e.target.value)} />
                <span className="text-xs text-muted-foreground">a</span>
                <input type="date" className={selectCls} value={cTo} onChange={(e) => setCTo(e.target.value)} />
              </>
            )}
          </div>
        </div>

        <TabsContent value="pnl" className="mt-4">
          <PnL movements={movements} range={range} />
        </TabsContent>
        <TabsContent value="gastos" className="mt-4">
          <Gastos movements={movements} range={range} />
        </TabsContent>
        <TabsContent value="libro" className="mt-4">
          <Libro movements={movements} cajas={cajas} range={range} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
const monthLabel = (mk: string) => MONTHS[Number(mk.slice(5, 7)) - 1] + " " + mk.slice(2, 4)
const inRange = (m: CashflowMovement, r: Range) => { const d = m.date?.slice(0, 10); return !!d && d >= r.from && d <= r.to }

// ============================ Estado de Resultados ============================
type PnlRow = { label: string; vals: Record<string, number>; total: number; kind: "detail" | "subtotal" | "total" | "margin" | "section" }

function PnL({ movements, range }: { movements: CashflowMovement[]; range: Range }) {
  const { rows, months, transferCount, transferNet } = useMemo(() => {
    const lines: Record<string, Record<string, number>> = {}
    const monthsSet = new Set<string>()
    let transferCount = 0, transferNet = 0
    for (const m of movements) {
      if (!inRange(m, range)) continue
      if (m.transfer) { transferCount++; transferNet += (m.amount_usd || 0) * (m.flow === "Ingreso" ? 1 : -1); continue }
      const mk = m.date!.slice(0, 7)
      monthsSet.add(mk)
      const v = (m.amount_usd || 0) * (m.flow === "Ingreso" ? 1 : -1)
      const line = plLine(m)
      ;(lines[line] ??= {})[mk] = (lines[line][mk] || 0) + v
    }
    const months = [...monthsSet].sort()
    const get = (n: string) => lines[n] ?? {}
    const sum = (names: string[]) => { const a: Record<string, number> = {}; for (const mk of months) { a[mk] = 0; for (const n of names) a[mk] += get(n)[mk] || 0 } return a }
    const tot = (a: Record<string, number>) => months.reduce((s, mk) => s + (a[mk] || 0), 0)
    const fill = (o: Record<string, number>) => Object.fromEntries(months.map((mk) => [mk, o[mk] || 0]))

    const ingresos = sum(REVENUE)
    const grossProfit = REVENUE.concat(COGS_LINES); const gp = sum(grossProfit)
    const ebitArr = grossProfit.concat(OPEX); const ebit = sum(ebitArr)
    const netArr = ebitArr.concat(BELOW); const net = sum(netArr)
    const marginRow = (label: string, arr: Record<string, number>): PnlRow => ({
      label, kind: "margin",
      vals: Object.fromEntries(months.map((mk) => [mk, ingresos[mk] ? arr[mk] / ingresos[mk] : NaN])),
      total: tot(ingresos) ? tot(arr) / tot(ingresos) : NaN,
    })
    const line = (label: string): PnlRow => ({ label, kind: "detail", vals: fill(get(label)), total: tot(get(label)) })
    const subtotal = (label: string, arr: Record<string, number>): PnlRow => ({ label, kind: "subtotal", vals: arr, total: tot(arr) })
    const total = (label: string, arr: Record<string, number>): PnlRow => ({ label, kind: "total", vals: arr, total: tot(arr) })

    const rows: PnlRow[] = [
      { label: "Ingresos por venta", kind: "section", vals: {}, total: 0 },
      ...REVENUE.map(line),
      subtotal("Ingresos Totales", ingresos),
      ...COGS_LINES.map(line),
      total("Ganancia Bruta", gp),
      marginRow("Margen Bruto", gp),
      { label: "Gastos operativos", kind: "section", vals: {}, total: 0 },
      ...OPEX.map(line),
      total("Ganancia Operacional (EBIT)", ebit),
      marginRow("Margen Operacional", ebit),
      ...BELOW.map(line),
      total("Ganancia Neta", net),
      marginRow("Margen Neto", net),
    ]
    return { rows, months, transferCount, transferNet }
  }, [movements, range])

  if (!months.length) return <Card className="p-8 text-center text-sm text-muted-foreground">Sin movimientos en el período.</Card>

  return (
    <>
    <Card className="overflow-x-auto py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 bg-card min-w-[230px]">Concepto</TableHead>
            {months.map((mk) => <TableHead key={mk} className="text-right tabular">{monthLabel(mk)}</TableHead>)}
            <TableHead className="text-right tabular font-semibold">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, idx) => {
            if (r.kind === "section") {
              return (
                <TableRow key={idx} className="border-0 hover:bg-transparent">
                  <TableCell colSpan={months.length + 2} className="pt-4 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{r.label}</TableCell>
                </TableRow>
              )
            }
            const isMargin = r.kind === "margin"
            const isBold = r.kind === "total" || r.kind === "subtotal"
            const cell = (v: number, key: string) => (
              <TableCell key={key} className={cn(
                "text-right tabular whitespace-nowrap",
                isMargin ? "italic text-muted-foreground" : v < 0 ? "text-muted-foreground" : "",
                isBold && "font-semibold",
              )}>
                {isMargin ? pct(v) : money(v)}
              </TableCell>
            )
            return (
              <TableRow key={idx} className={cn(
                isBold && "border-t border-border font-semibold",
                "hover:bg-muted/30",
              )}>
                <TableCell className={cn(
                  "sticky left-0 bg-card",
                  r.kind === "detail" && "pl-6 text-muted-foreground text-xs",
                  isMargin && "pl-6 italic text-muted-foreground text-xs",
                  isBold && "font-semibold",
                )}>{r.label}</TableCell>
                {months.map((mk) => cell(r.vals[mk] ?? (r.kind === "margin" ? NaN : 0), mk))}
                {cell(r.total, "total")}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
    {transferCount ? (
      <p className="text-[11px] text-muted-foreground mt-2">
        Se excluyeron {transferCount} movimientos entre cuentas (transferencias / cambios de moneda, neto {money(transferNet)}) — no afectan el resultado, pero sí los saldos de caja.
      </p>
    ) : null}
    </>
  )
}

// ============================ Gastos Fijo/Variable ============================
function Gastos({ movements, range }: { movements: CashflowMovement[]; range: Range }) {
  const { rows, totals } = useMemo(() => {
    const byType: Record<string, { Fijo: number; Variable: number; Mixto: number; total: number }> = {}
    const totals = { Fijo: 0, Variable: 0, Mixto: 0, total: 0 }
    for (const m of movements) {
      if (m.flow !== "Egreso" || m.transfer || !inRange(m, range)) continue
      const type = m.expense_type || "Otros Gastos y Ajustes"
      const fv = (m.fixed_variable === "Fijo" || m.fixed_variable === "Variable" || m.fixed_variable === "Mixto") ? m.fixed_variable : "Variable"
      const amt = m.amount_usd || 0
      const row = (byType[type] ??= { Fijo: 0, Variable: 0, Mixto: 0, total: 0 })
      row[fv] += amt; row.total += amt
      totals[fv] += amt; totals.total += amt
    }
    const rows = Object.entries(byType).map(([type, v]) => ({ type, ...v })).sort((a, b) => b.total - a.total)
    return { rows, totals }
  }, [movements, range])

  if (!rows.length) return <Card className="p-8 text-center text-sm text-muted-foreground">Sin egresos en el período.</Card>

  return (
    <Card className="overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tipo de gasto</TableHead>
            <TableHead className="text-right">Fijo</TableHead>
            <TableHead className="text-right">Variable</TableHead>
            <TableHead className="text-right">Mixto</TableHead>
            <TableHead className="text-right font-semibold">Total</TableHead>
            <TableHead className="text-right">% del total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.type} className="hover:bg-muted/30">
              <TableCell className="font-medium">{r.type}</TableCell>
              <TableCell className="text-right tabular text-muted-foreground">{money(r.Fijo)}</TableCell>
              <TableCell className="text-right tabular text-muted-foreground">{money(r.Variable)}</TableCell>
              <TableCell className="text-right tabular text-muted-foreground">{money(r.Mixto)}</TableCell>
              <TableCell className="text-right tabular font-semibold">{money(r.total)}</TableCell>
              <TableCell className="text-right tabular text-muted-foreground">{totals.total ? pct(r.total / totals.total) : "—"}</TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t border-border font-semibold">
            <TableCell className="font-semibold">Total egresos</TableCell>
            <TableCell className="text-right tabular">{money(totals.Fijo)}</TableCell>
            <TableCell className="text-right tabular">{money(totals.Variable)}</TableCell>
            <TableCell className="text-right tabular">{money(totals.Mixto)}</TableCell>
            <TableCell className="text-right tabular">{money(totals.total)}</TableCell>
            <TableCell className="text-right tabular text-muted-foreground">100%</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  )
}

// ============================ Libro (filtros + orden) ============================
type SortKey = "date" | "flow" | "caja_name" | "rubro" | "counterparty" | "amount_usd"

function Libro({ movements, cajas, range }: { movements: CashflowMovement[]; cajas: Caja[]; range: Range }) {
  const [flow, setFlow] = useState("Todos")
  const [cajaId, setCajaId] = useState("Todas")
  const [rubro, setRubro] = useState("Todos")
  const [q, setQ] = useState("")
  const [onlyReview, setOnlyReview] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const rubros = useMemo(
    () => [...new Set(movements.map(rubroOf).filter((r) => r !== "—"))].sort(),
    [movements],
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = movements.filter((m) => {
      if (!inRange(m, range)) return false
      if (flow !== "Todos" && m.flow !== flow) return false
      if (cajaId !== "Todas" && m.caja_id !== cajaId) return false
      if (rubro !== "Todos" && rubroOf(m) !== rubro) return false
      if (onlyReview && !m.needs_review) return false
      if (needle) {
        const hay = `${m.counterparty ?? ""} ${m.description ?? ""} ${rubroOf(m)} ${m.id}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    const dir = sortDir === "asc" ? 1 : -1
    return out.sort((a, b) => {
      if (sortKey === "amount_usd") return ((a.amount_usd ?? 0) - (b.amount_usd ?? 0)) * dir
      const av = sortKey === "rubro" ? rubroOf(a) : (a[sortKey] ?? "")
      const bv = sortKey === "rubro" ? rubroOf(b) : (b[sortKey] ?? "")
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [movements, range, flow, cajaId, rubro, q, onlyReview, sortKey, sortDir])

  const reviewCount = useMemo(() => movements.filter((m) => m.needs_review).length, [movements])
  const shown = filtered.slice(0, 400)

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(k); setSortDir(k === "amount_usd" || k === "date" ? "desc" : "asc") }
  }
  const SortHead = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <TableHead className={right ? "text-right" : undefined}>
      <button onClick={() => toggleSort(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", right && "flex-row-reverse")}>
        {children}
        {sortKey === k ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </TableHead>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select className={selectCls} value={flow} onChange={(e) => setFlow(e.target.value)}>
            <option value="Todos">Todos los flujos</option>
            <option value="Ingreso">Ingresos</option>
            <option value="Egreso">Egresos</option>
          </select>
          <select className={selectCls} value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
            <option value="Todas">Todas las cajas</option>
            {cajas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={selectCls} value={rubro} onChange={(e) => setRubro(e.target.value)}>
            <option value="Todos">Todos los tipos</option>
            {rubros.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={() => setOnlyReview((v) => !v)}
            className={cn("h-8 rounded-md border px-2 text-xs inline-flex items-center gap-1", onlyReview ? "border-foreground text-foreground" : "border-input text-muted-foreground")}
          >
            <AlertTriangle className="h-3.5 w-3.5" /> A revisar ({reviewCount})
          </button>
        </div>
        <div className="relative w-full lg:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar motivo, descripción…" className="pl-8 h-8" />
        </div>
      </div>
      <div className="text-xs text-muted-foreground">Mostrando {shown.length} de {filtered.length} movimientos</div>
      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead k="date">Fecha</SortHead>
              <SortHead k="flow">Tipo</SortHead>
              <SortHead k="caja_name">Caja</SortHead>
              <SortHead k="rubro">Tipo de gasto</SortHead>
              <SortHead k="counterparty">Motivo / Contraparte</SortHead>
              <SortHead k="amount_usd" right>USD</SortHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((m) => (
              <TableRow key={m.id} className={cn("hover:bg-muted/30", m.needs_review && "bg-muted/40")}>
                <TableCell className="text-xs text-muted-foreground tabular whitespace-nowrap">{fmtDate(m.date)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px] font-normal">{m.flow}</Badge>
                  {m.transfer ? <Badge variant="outline" className="ml-1 text-[10px] font-normal text-muted-foreground" title="Movimiento entre cuentas — excluido del P&L">↔</Badge> : null}
                </TableCell>
                <TableCell className="text-xs">
                  {m.caja_name || <span className="text-muted-foreground inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />s/caja</span>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[190px] truncate">
                  {rubroOf(m)}{m.subcategory ? <span className="opacity-60"> · {m.subcategory}</span> : null}
                </TableCell>
                <TableCell className="text-xs max-w-[260px] truncate">
                  <div className="font-medium truncate">{m.counterparty || "—"}</div>
                  {m.description ? <div className="text-[11px] text-muted-foreground truncate">{m.description}</div> : null}
                </TableCell>
                <TableCell className={cn("text-right tabular whitespace-nowrap", m.flow === "Egreso" && "text-muted-foreground")}>
                  {m.flow === "Egreso" ? "-" : ""}{money(m.amount_usd || 0).replace("-", "")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
