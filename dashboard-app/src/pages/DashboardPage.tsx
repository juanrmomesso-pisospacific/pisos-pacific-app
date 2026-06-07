import { useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ArrowUp, ArrowDown, Minus, LineChart, BarChart3 } from "lucide-react"
import { useApi } from "@/lib/api"
import { usePeriod } from "@/contexts/PeriodContext"
import { QuickPeriod } from "@/components/QuickPeriod"
import { fmtMoney, fmtInt, cn } from "@/lib/utils"
import type { Sale, CashflowMovement, Product } from "@/lib/types"

// ---- Período (filtro global) ----
type Range = { from: string; to: string }
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
function prevRange(r: Range): Range {
  const from = new Date(r.from + "T12:00:00"), to = new Date(r.to + "T12:00:00")
  const len = Math.max(1, Math.round((+to - +from) / 86400000) + 1)
  const pTo = new Date(from); pTo.setDate(pTo.getDate() - 1)
  const pFrom = new Date(pTo); pFrom.setDate(pFrom.getDate() - len + 1)
  return { from: ymd(pFrom), to: ymd(pTo) }
}

// Desde esta fecha la cobertura de costos por venta es completa (backfill 2026).
// Antes: solo ventas con SKU tenían costo → el P&L devengado no cierra. Es histórico (ver caja).
const DEVENGADO_DESDE = "2026-01-01"
const saleDate = (s: Sale) => (s.created_at || "").slice(0, 10)
const billed = (s: Sale) => (s.venta_neta != null ? s.venta_neta : s.contract_total) || 0
const inRange = (d: string, r: Range) => !!d && d >= r.from && d <= r.to

// Gastos operativos del P&L (de Admin para abajo). Instalaciones/Suministros se trata
// aparte: la mano de obra de colocación ya está en el costo de servicio; los materiales
// van como "Insumos grales. colocación" en el bloque de costos.
const OPEX_ORDER = [
  "Gastos Administrativos", "Gastos de Personal (HR y Mano de Obra)", "Marketing y Ventas",
  "Gastos de Flota/Vehículos", "Depreciación y Amortización", "Impuestos y Tasas", "Otros Gastos y Ajustes",
]

export default function DashboardPage() {
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const cashflow = useApi<CashflowMovement[]>("/api/cashflow").data ?? []
  const products = useApi<Product[]>("/api/products").data ?? []
  const { range: gRange } = usePeriod()
  const [chartMode, setChartMode] = useState<"line" | "bar">(() => (typeof window !== "undefined" && window.localStorage.getItem("dash:chart") === "bar") ? "bar" : "line")
  const setChart = (m: "line" | "bar") => { setChartMode(m); if (typeof window !== "undefined") window.localStorage.setItem("dash:chart", m) }

  // Cobertura de costos completa desde acá → el análisis devengado no va más atrás
  // (antes el costo no está cargado y el margen/neto pierde sentido).
  const rawFrom = ymd(gRange.from), to = ymd(gRange.to)
  const clamped = rawFrom < DEVENGADO_DESDE
  const range = useMemo(() => ({ from: clamped ? DEVENGADO_DESDE : rawFrom, to }), [rawFrom, to, clamped])
  const prev = useMemo(() => prevRange(range), [range])

  // Producto piso (m²): por stockTrack y activo. Mapa sku→producto.
  const prodBySku = useMemo(() => { const m = new Map<string, Product>(); for (const p of products) m.set(p.sku, p); return m }, [products])
  const isPisoItem = (sku?: string) => { const p = sku ? prodBySku.get(sku) : undefined; return !!p && !!p.stockTrack && p.active !== false }
  // Colocadores: su mano de obra ya está en el costo de servicio → se excluye del opex.
  const settings = useApi<{ installers?: string[] }>("/api/settings").data
  const installerSet = useMemo(() => new Set((settings?.installers ?? []).map(x => x.trim())), [settings])

  // ---- Métricas por período (alineadas al P&L híbrido) ----
  const metrics = (r: Range) => {
    const inP = sales.filter(s => inRange(saleDate(s), r) && s.status !== "Cancelado")
    const fact = inP.reduce((a, s) => a + billed(s), 0)
    const detailed = inP.filter(s => s.has_sku_detail && s.margin_bd)
    // Bruto "obra completo" = ingresos (piso+servicio+extras) − costos bloqueados − insumos generales de colocación.
    let ingV = 0, costV = 0
    for (const s of detailed) for (const k of ["piso", "servicio", "extras"] as const) { ingV += s.margin_bd![k].rev; costV += s.margin_bd![k].cost }
    const opex = cashflow.filter(m => m.flow === "Egreso" && !m.transfer && inRange((m.date || "").slice(0, 10), r) && (m.expense_type || "") !== "COGS")
    let insumosColoc = 0, opexTotal = 0
    for (const m of opex) {
      if (installerSet.has((m.counterparty || "").trim())) continue
      if ((m.expense_type || "") === "Gastos de Instalaciones y Suministros") insumosColoc += m.amount_usd || 0
      else opexTotal += m.amount_usd || 0
    }
    const grossProfit = ingV - costV - insumosColoc
    const grossPct = ingV ? grossProfit / ingV : NaN
    const m2 = inP.reduce((a, s) => a + (s.items || []).filter(it => isPisoItem(it.sku)).reduce((x, it) => x + (Number(it.quantity) || 0), 0), 0)
    const neto = grossProfit - opexTotal
    return { fact, grossProfit, grossPct, m2, opexTotal, neto, count: inP.length, detailedCount: detailed.length, opex }
  }
  const cur = useMemo(() => metrics(range), [sales, cashflow, products, range, installerSet])
  const pre = useMemo(() => metrics(prev), [sales, cashflow, products, prev, installerSet])

  // Pendiente de cobro (no depende del período: estado actual)
  const pendiente = useMemo(() => {
    const due = sales.filter(s => (s.cashflow_balance_due ?? s.financial_position?.balance_due ?? 0) > 0.5)
    return { total: due.reduce((a, s) => a + (s.cashflow_balance_due ?? s.financial_position?.balance_due ?? 0), 0), count: due.length }
  }, [sales])

  // ---- Facturación + volumen por mes (con desglose por categoría para la vista apilada) ----
  const byMonth = useMemo(() => {
    const m = new Map<string, { fact: number; m2: number; piso: number; servicio: number; extras: number }>()
    for (const s of sales) {
      const d = saleDate(s); if (!inRange(d, range) || s.status === "Cancelado") continue
      const mk = d.slice(0, 7)
      const row = m.get(mk) ?? { fact: 0, m2: 0, piso: 0, servicio: 0, extras: 0 }
      row.fact += billed(s)
      row.m2 += (s.items || []).filter(it => isPisoItem(it.sku)).reduce((x, it) => x + (Number(it.quantity) || 0), 0)
      if (s.margin_bd) { row.piso += s.margin_bd.piso.rev; row.servicio += s.margin_bd.servicio.rev; row.extras += s.margin_bd.extras.rev }
      m.set(mk, row)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mk, v]) => ({ mk, ...v }))
  }, [sales, range, products])

  // ---- P&L híbrido (devengado): ingresos/costos por categoría desde ventas; opex desde cashflow ----
  const pnl = useMemo(() => {
    // Ingresos y costos por categoría (Piso/Servicio/Extras) desde ventas con costo bloqueado.
    const cat = { piso: { rev: 0, cost: 0 }, servicio: { rev: 0, cost: 0 }, extras: { rev: 0, cost: 0 } }
    for (const s of sales) {
      if (!inRange(saleDate(s), range) || s.status === "Cancelado" || !s.margin_bd) continue
      for (const k of ["piso", "servicio", "extras"] as const) {
        cat[k].rev += s.margin_bd[k].rev; cat[k].cost += s.margin_bd[k].cost
      }
    }
    // Egresos del cashflow del período. Colocadores (installerSet) → ya en costo de servicio, se excluyen.
    const opexBy: Record<string, number> = {}
    let insumosColoc = 0
    for (const m of cur.opex) {
      const cp = (m.counterparty || "").trim()
      if (installerSet.has(cp)) continue // mano de obra de colocación: ya está en Costo Servicio
      const t = m.expense_type || "Otros Gastos y Ajustes"
      if (t === "Gastos de Instalaciones y Suministros") { insumosColoc += m.amount_usd || 0; continue }
      opexBy[t] = (opexBy[t] || 0) + (m.amount_usd || 0)
    }
    const ingresos = cat.piso.rev + cat.servicio.rev + cat.extras.rev
    const costos = cat.piso.cost + cat.servicio.cost + cat.extras.cost + insumosColoc
    return { cat, insumosColoc, ingresos, costos, bruta: ingresos - costos, opexBy }
  }, [cur, sales, range, installerSet])

  // ---- Top productos PISO vendidos ----
  const topPisos = useMemo(() => {
    const agg = new Map<string, { name: string; m2: number; monto: number }>()
    for (const s of sales) {
      if (!inRange(saleDate(s), range) || s.status === "Cancelado") continue
      for (const it of s.items || []) {
        if (!isPisoItem(it.sku)) continue
        const k = it.sku || it.description || "—"
        const row = agg.get(k) ?? { name: it.description || it.sku || "—", m2: 0, monto: 0 }
        const qty = Number(it.quantity) || 0
        row.m2 += qty
        row.monto += (Number(it.total) || qty * (Number(it.unit_price) || 0)) - (Number(it.discount) || 0)
        agg.set(k, row)
      }
    }
    return [...agg.values()].sort((a, b) => b.m2 - a.m2).slice(0, 10)
  }, [sales, range, products])

  // ---- Stock crítico (solo activos con stock) ----
  const stockAlerts = useMemo(() => {
    return products.filter(p => p.active !== false && p.stockTrack).map(p => {
      const stock = Number(p.stock) || 0, reserved = Number(p.committed ?? p.reservedStock) || 0
      return { p, stock, reserved, available: stock - reserved }
    }).filter(x => x.available <= 5).sort((a, b) => a.available - b.available)
  }, [products])

  // ---- Margen por obra (top y bottom) ----
  const porObra = useMemo(() => {
    const list = sales.filter(s => inRange(saleDate(s), range) && s.status !== "Cancelado" && s.has_sku_detail && s.margin != null)
      .map(s => ({ s, margin: s.margin || 0, pct: s.margin_pct ?? null }))
      .sort((a, b) => b.margin - a.margin)
    return { top: list.slice(0, 5), bottom: list.slice(-5).reverse() }
  }, [sales, range])

  const delta = (c: number, p: number) => p === 0 ? null : { pct: (c - p) / Math.abs(p), up: c >= p }

  return (
    <div className="px-4 lg:px-6 space-y-4">
      {/* Período */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-muted-foreground">
          Performance · {gRange.label} · {range.from} a {range.to}
          {clamped && <span className="ml-2 text-[11px] text-amber-600">· análisis devengado desde ene-2026 (cobertura de costos)</span>}
        </div>
        <QuickPeriod />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 @4xl/main:grid-cols-4 gap-3">
        <Kpi label="Facturación" value={fmtMoney(cur.fact)} sub={`${cur.count} ventas`} delta={delta(cur.fact, pre.fact)} />
        <Kpi label="Margen bruto" value={fmtMoney(cur.grossProfit)} sub={isFinite(cur.grossPct) ? `${(cur.grossPct * 100).toFixed(1)}% · ${cur.detailedCount} c/ costo` : "sin costo cargado"} delta={delta(cur.grossProfit, pre.grossProfit)} />
        <Kpi label="Resultado neto" value={fmtMoney(cur.neto)} sub={`bruto − gastos (${fmtMoney(cur.opexTotal)})`} delta={delta(cur.neto, pre.neto)} />
        <Kpi label="Pendiente de cobro" value={fmtMoney(pendiente.total)} sub={`${pendiente.count} ventas`} delta={null} />
      </div>

      {/* Facturación + volumen | P&L */}
      <div className="grid grid-cols-1 @4xl/main:grid-cols-3 gap-4">
        <Card className="@4xl/main:col-span-2 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <div className="text-sm font-medium">Facturación y volumen por mes</div>
              <div className="text-[11px] text-muted-foreground">Facturación en US$ · volumen en m² de piso</div>
            </div>
            <div className="inline-flex items-center gap-0.5 rounded-[10px] bg-muted/60 p-[3px]">
              <button onClick={() => setChart("line")} title="Líneas"
                className={cn("h-7 w-8 inline-flex items-center justify-center rounded-lg transition", chartMode === "line" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                <LineChart className="h-4 w-4" />
              </button>
              <button onClick={() => setChart("bar")} title="Barras"
                className={cn("h-7 w-8 inline-flex items-center justify-center rounded-lg transition", chartMode === "bar" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                <BarChart3 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <FactChart data={byMonth} mode={chartMode} />
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium">Estado de resultados (devengado)</div>
          <div className="text-[10px] text-muted-foreground mb-1">Por ventas con costo bloqueado. La vista de caja está en CashFlow → Análisis Financiero.</div>
          <PnlMini pnl={pnl} />
        </Card>
      </div>

      {/* Top pisos | Stock crítico */}
      <div className="grid grid-cols-1 @4xl/main:grid-cols-2 gap-4">
        <Card className="overflow-hidden py-0">
          <div className="px-4 py-3 text-sm font-medium border-b border-border">Productos PISO más vendidos</div>
          <Table>
            <TableHeader><TableRow><TableHead>Producto</TableHead><TableHead className="text-right">m²</TableHead><TableHead className="text-right">Facturado</TableHead></TableRow></TableHeader>
            <TableBody>
              {topPisos.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">Sin ventas de piso en el período</TableCell></TableRow>
                : topPisos.map((r, i) => <TableRow key={i}><TableCell className="max-w-[280px] truncate">{r.name}</TableCell><TableCell className="text-right tabular">{fmtInt(r.m2)}</TableCell><TableCell className="text-right tabular">{fmtMoney(r.monto)}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </Card>
        <Card className="overflow-hidden py-0">
          <div className="px-4 py-3 text-sm font-medium border-b border-border flex items-center justify-between">Stock crítico <Badge variant="outline" className="text-[10px]">{stockAlerts.length}</Badge></div>
          <Table>
            <TableHeader><TableRow><TableHead>Producto</TableHead><TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Comprometido</TableHead><TableHead className="text-right">Disponible</TableHead></TableRow></TableHeader>
            <TableBody>
              {stockAlerts.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">Sin faltantes — todo OK</TableCell></TableRow>
                : stockAlerts.map(({ p, stock, reserved, available }) => <TableRow key={p.id}><TableCell className="max-w-[240px] truncate">{p.name}</TableCell><TableCell className="text-right tabular">{fmtInt(stock)}</TableCell><TableCell className="text-right tabular text-amber-600">{fmtInt(reserved)}</TableCell><TableCell className={cn("text-right tabular font-medium", available < 0 ? "text-destructive" : "text-amber-600")}>{fmtInt(available)}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Margen por obra */}
      <div className="grid grid-cols-1 @4xl/main:grid-cols-2 gap-4">
        <ObraTable title="Mejores márgenes (obra)" rows={porObra.top} />
        <ObraTable title="Márgenes más bajos (obra)" rows={porObra.bottom} />
      </div>
      <div className="text-[11px] text-muted-foreground pb-4">
        <b>P&amp;L devengado:</b> ingresos y costos (Piso/Servicio/Extras) desde ventas con costo bloqueado al confirmar; insumos generales de colocación y gastos desde la planilla/cashflow. La mano de obra de colocadores ya está en el costo de servicio (no se cuenta dos veces). Productos inactivos excluidos. Para el resultado de caja completo (incluye Paneles): CashFlow → Análisis Financiero.
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta: { pct: number; up: boolean } | null }) {
  const Icon = delta == null ? Minus : delta.up ? ArrowUp : ArrowDown
  return (
    <Card className="p-4 gap-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center justify-between">
        {label}
        {delta != null && <span className={cn("inline-flex items-center gap-0.5 text-[10px]", delta.up ? "text-emerald-600" : "text-destructive")}><Icon className="h-3 w-3" />{Math.abs(delta.pct * 100).toFixed(0)}%</span>}
      </div>
      <div className="text-2xl font-semibold serif tabular">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  )
}

type ChartRow = { mk: string; fact: number; m2: number; piso: number; servicio: number; extras: number }
// Tokens del handoff: tinta + naranja para volumen.
const C_FACT = "#222222", C_M2 = "#E08A3C", C_GRID = "#ededed"
const niceMax = (v: number) => {
  if (v <= 0) return 1
  const rough = v * 1.08, mag = Math.pow(10, Math.floor(Math.log10(rough))), n = rough / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * mag
}
const smoothPath = (pts: [number, number][]) => {
  if (pts.length < 2) return pts.length ? `M ${pts[0][0]} ${pts[0][1]}` : ""
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], mx = (x0 + x1) / 2
    d += ` C ${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`
  }
  return d
}
const fmtUSDk = (v: number) => "US$ " + (v >= 1000 ? Math.round(v / 1000) + "k" : Math.round(v).toString())
const fmtM2 = (v: number) => Math.round(v).toLocaleString("es-AR") + " m²"
const tickUSD = (v: number) => v === 0 ? "0" : v >= 1000 ? (Math.round(v / 100) / 10) + "k" : Math.round(v).toString()

function FactChart({ data, mode }: { data: ChartRow[]; mode: "line" | "bar" }) {
  const [visible, setVisible] = useState<{ fact: boolean; m2: boolean }>({ fact: true, m2: true })
  const [hover, setHover] = useState<number | null>(null)
  if (data.length === 0) return <div className="text-sm text-muted-foreground py-10 text-center">Sin datos en el período</div>

  const W = 800, H = 360, M = { top: 28, right: 54, bottom: 40, left: 54 }
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom, base = M.top + ih
  const n = data.length
  const maxFact = niceMax(Math.max(...data.map(d => d.fact)))
  const maxM2 = niceMax(Math.max(...data.map(d => d.m2)))
  const x = (i: number) => n === 1 ? M.left + iw / 2 : M.left + iw * (i / (n - 1))
  const xBand = (i: number) => M.left + iw * ((i + 0.5) / n)
  const yF = (v: number) => M.top + ih * (1 - v / maxFact)
  const yM = (v: number) => M.top + ih * (1 - v / maxM2)
  const monthLbl = (mk: string) => ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(mk.slice(5, 7)) - 1] + " " + mk.slice(2, 4)
  const factPts = data.map((d, i) => [x(i), yF(d.fact)] as [number, number])
  const m2Pts = data.map((d, i) => [x(i), yM(d.m2)] as [number, number])

  const toggle = (s: "fact" | "m2") => setVisible(v => {
    if (v[s] && !(s === "fact" ? v.m2 : v.fact)) return v // guard: al menos una visible
    return { ...v, [s]: !v[s] }
  })
  const hoveredX = hover == null ? 0 : (mode === "bar" ? xBand(hover) : x(hover))
  const tipLeft = Math.max(8, Math.min(92, (hoveredX / W) * 100))

  return (
    <div className="relative mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: "auto", overflow: "visible" }}>
        {/* gridlines + ejes */}
        {[0, 1, 2, 3, 4].map(g => {
          const gy = M.top + ih * g / 4
          return <line key={g} x1={M.left} x2={M.left + iw} y1={gy} y2={gy} stroke={C_GRID} strokeWidth={1} strokeDasharray={g === 4 ? undefined : "3 4"} />
        })}
        {[0, 1, 2, 3, 4].map(g => (
          <text key={g} x={M.left - 12} y={M.top + ih * g / 4 + 4} textAnchor="end" style={{ fontSize: 12, fill: "#9a9a9a" }}>{tickUSD(maxFact * (1 - g / 4))}</text>
        ))}
        {[0, 1, 2, 3, 4].map(g => (
          <text key={g} x={M.left + iw + 12} y={M.top + ih * g / 4 + 4} textAnchor="start" style={{ fontSize: 12, fill: C_M2 }}>{Math.round(maxM2 * (1 - g / 4))}</text>
        ))}
        {data.map((d, i) => <text key={i} x={mode === "bar" ? xBand(i) : x(i)} y={H - 14} textAnchor="middle" style={{ fontSize: 13, fill: "#6b6b6b" }}>{monthLbl(d.mk)}</text>)}

        {/* series */}
        {mode === "line" ? (<>
          {visible.fact && <>
            <defs><linearGradient id="gF" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C_FACT} stopOpacity={0.10} /><stop offset="100%" stopColor={C_FACT} stopOpacity={0} /></linearGradient></defs>
            <path d={`${smoothPath(factPts)} L ${factPts[n - 1][0]} ${base} L ${factPts[0][0]} ${base} Z`} fill="url(#gF)" />
            <path d={smoothPath(factPts)} fill="none" stroke={C_FACT} strokeWidth={2.5} strokeLinecap="round" />
          </>}
          {visible.m2 && <path d={smoothPath(m2Pts)} fill="none" stroke={C_M2} strokeWidth={2.5} strokeDasharray="1 7" strokeLinecap="round" strokeLinejoin="round" />}
          {data.map((d, i) => <g key={i}>
            {visible.fact && <circle cx={x(i)} cy={yF(d.fact)} r={3.5} fill="#fff" stroke={C_FACT} strokeWidth={2} />}
            {visible.m2 && <circle cx={x(i)} cy={yM(d.m2)} r={3.5} fill="#fff" stroke={C_M2} strokeWidth={2} />}
          </g>)}
        </>) : (
          data.map((d, i) => {
            const bw = iw / n, inner = bw - bw * 0.30 * 2
            const cx = xBand(i)
            const both = visible.fact && visible.m2
            const out: React.ReactNode[] = []
            const roundBar = (bx: number, by: number, bwd: number, h: number, fill: string, op = 1) => {
              const r = Math.max(0, Math.min(4, bwd / 2, h))
              return <path key={fill + bx} d={`M ${bx} ${by + h} L ${bx} ${by + r} Q ${bx} ${by} ${bx + r} ${by} L ${bx + bwd - r} ${by} Q ${bx + bwd} ${by} ${bx + bwd} ${by + r} L ${bx + bwd} ${by + h} Z`} fill={fill} opacity={op} />
            }
            if (both) {
              const half = inner / 2 - 2
              if (visible.fact) out.push(roundBar(cx - half - 1, yF(d.fact), half, base - yF(d.fact), C_FACT))
              if (visible.m2) out.push(roundBar(cx + 1, yM(d.m2), half, base - yM(d.m2), C_M2, 0.92))
            } else if (visible.fact) out.push(roundBar(cx - inner / 2, yF(d.fact), inner, base - yF(d.fact), C_FACT))
            else if (visible.m2) out.push(roundBar(cx - inner / 2, yM(d.m2), inner, base - yM(d.m2), C_M2, 0.92))
            return <g key={i}>{out}</g>
          })
        )}

        {/* hover: crosshair + puntos agrandados (line) */}
        {hover != null && mode === "line" && <>
          <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={base} stroke="#cfcfcf" strokeWidth={1} strokeDasharray="3 3" />
          {visible.fact && <circle cx={x(hover)} cy={yF(data[hover].fact)} r={5} fill={C_FACT} />}
          {visible.m2 && <circle cx={x(hover)} cy={yM(data[hover].m2)} r={5} fill={C_M2} />}
        </>}

        {/* zonas de hover */}
        {data.map((_, i) => {
          const zw = iw / n
          return <rect key={i} x={M.left + zw * i} y={M.top} width={zw} height={ih} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(h => h === i ? null : h)} style={{ cursor: "pointer" }} />
        })}
      </svg>

      {/* tooltip */}
      {hover != null && (
        <div className="absolute pointer-events-none z-10 rounded-[11px] px-3 py-2.5 whitespace-nowrap"
          style={{ left: `${tipLeft}%`, top: 0, transform: "translate(-50%, -104%)", background: "#1f1f1f", color: "#fff", fontSize: 12.5, lineHeight: 1.5, boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}>
          <div className="font-semibold mb-1" style={{ fontSize: 12 }}>{monthLbl(data[hover].mk)}</div>
          {visible.fact && <div className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full" style={{ background: C_FACT, outline: "1px solid #555" }} />Facturación<span className="ml-auto pl-3.5 font-semibold">{fmtUSDk(data[hover].fact)}</span></div>}
          {visible.m2 && <div className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full" style={{ background: C_M2 }} />Volumen<span className="ml-auto pl-3.5 font-semibold">{fmtM2(data[hover].m2)}</span></div>}
        </div>
      )}

      {/* leyenda clickeable */}
      <div className="flex items-center gap-6 mt-4 pt-3 border-t border-border text-sm" style={{ color: "#6b6b6b" }}>
        <button onClick={() => toggle("fact")} className={cn("inline-flex items-center gap-2 transition-opacity", !visible.fact && "opacity-35")}>
          <span className="inline-block h-[3px] w-[18px] rounded" style={{ background: C_FACT }} />Facturación (US$)
        </button>
        <button onClick={() => toggle("m2")} className={cn("inline-flex items-center gap-2 transition-opacity", !visible.m2 && "opacity-35")}>
          <span className="inline-block h-[3px] w-[18px] rounded" style={{ background: `repeating-linear-gradient(90deg, ${C_M2} 0 5px, transparent 5px 8px)` }} />m² de piso vendidos
        </button>
      </div>
    </div>
  )
}

type Pnl = {
  cat: { piso: { rev: number; cost: number }; servicio: { rev: number; cost: number }; extras: { rev: number; cost: number } }
  insumosColoc: number; ingresos: number; costos: number; bruta: number; opexBy: Record<string, number>
}
function PnlMini({ pnl }: { pnl: Pnl }) {
  const opexTotal = OPEX_ORDER.reduce((a, t) => a + (pnl.opexBy[t] || 0), 0)
  const neto = pnl.bruta - opexTotal
  const brutoPct = pnl.ingresos ? pnl.bruta / pnl.ingresos : NaN
  const netoPct = pnl.ingresos ? neto / pnl.ingresos : NaN
  const Line = ({ l, v, bold, muted, indent }: { l: string; v: number; bold?: boolean; muted?: boolean; indent?: boolean }) => (
    <div className={cn("flex justify-between py-0.5 text-xs", bold && "font-semibold border-t border-border pt-1 mt-0.5", muted && "text-muted-foreground", indent && "pl-2")}>
      <span>{l}</span><span className="tabular">{fmtMoney(v)}</span>
    </div>
  )
  const Head = ({ l }: { l: string }) => <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-2 mb-0.5">{l}</div>
  return (
    <div>
      <Head l="Ingresos por venta" />
      <Line l="Piso" v={pnl.cat.piso.rev} indent />
      <Line l="Servicio (colocación)" v={pnl.cat.servicio.rev} indent />
      <Line l="Extras" v={pnl.cat.extras.rev} indent />
      <Line l="Ingresos totales" v={pnl.ingresos} bold />
      <Head l="Costos" />
      <Line l="Costo piso" v={-pnl.cat.piso.cost} muted indent />
      <Line l="Costo servicio" v={-pnl.cat.servicio.cost} muted indent />
      <Line l="Costo extras" v={-pnl.cat.extras.cost} muted indent />
      <Line l="Insumos grales. colocación" v={-pnl.insumosColoc} muted indent />
      <Line l={`Ganancia bruta · ${isFinite(brutoPct) ? (brutoPct * 100).toFixed(0) + "%" : "—"}`} v={pnl.bruta} bold />
      <Head l="Gastos" />
      {OPEX_ORDER.filter(t => pnl.opexBy[t]).map(t => <Line key={t} l={t.replace("Gastos de ", "").replace(" (HR y Mano de Obra)", "")} v={-(pnl.opexBy[t] || 0)} muted indent />)}
      <Line l={`Resultado neto · ${isFinite(netoPct) ? (netoPct * 100).toFixed(0) + "%" : "—"}`} v={neto} bold />
    </div>
  )
}

function ObraTable({ title, rows }: { title: string; rows: { s: Sale; margin: number; pct: number | null }[] }) {
  return (
    <Card className="overflow-hidden py-0">
      <div className="px-4 py-3 text-sm font-medium border-b border-border">{title}</div>
      <Table>
        <TableHeader><TableRow><TableHead>Obra</TableHead><TableHead className="text-right">Margen</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">Sin ventas con costo cargado</TableCell></TableRow>
            : rows.map(({ s, margin, pct }) => <TableRow key={s.id}><TableCell className="max-w-[240px] truncate">{s.title || s.client_name}</TableCell><TableCell className={cn("text-right tabular", margin < 0 && "text-destructive")}>{fmtMoney(margin)}</TableCell><TableCell className="text-right tabular text-muted-foreground">{pct != null ? pct.toFixed(0) + "%" : "—"}</TableCell></TableRow>)}
        </TableBody>
      </Table>
    </Card>
  )
}
