import { useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ArrowUp, ArrowDown, Minus } from "lucide-react"
import { useApi } from "@/lib/api"
import { fmtMoney, fmtInt, cn } from "@/lib/utils"
import type { Sale, CashflowMovement, Product } from "@/lib/types"

// ---- Período dinámico ----
type Range = { from: string; to: string }
const PRESETS = [
  { key: "m1", label: "Este mes", months: 1 }, { key: "m3", label: "3 meses", months: 3 },
  { key: "m6", label: "6 meses", months: 6 }, { key: "m12", label: "12 meses", months: 12 },
  { key: "ytd", label: "Año", months: 0 }, { key: "all", label: "Todo", months: -1 },
]
const iso = (d: Date) => d.toISOString().slice(0, 10)
function rangeFor(preset: string, minDate: string, maxDate: string): Range {
  const now = new Date()
  if (preset === "all") return { from: minDate, to: maxDate }
  if (preset === "ytd") return { from: iso(new Date(now.getFullYear(), 0, 1)), to: maxDate }
  const p = PRESETS.find(x => x.key === preset)!
  const d = new Date(now.getFullYear(), now.getMonth() - (p.months - 1), 1)
  return { from: iso(d), to: maxDate }
}
function prevRange(r: Range): Range {
  const from = new Date(r.from + "T12:00:00"), to = new Date(r.to + "T12:00:00")
  const len = Math.max(1, Math.round((+to - +from) / 86400000) + 1)
  const pTo = new Date(from); pTo.setDate(pTo.getDate() - 1)
  const pFrom = new Date(pTo); pFrom.setDate(pFrom.getDate() - len + 1)
  return { from: iso(pFrom), to: iso(pTo) }
}

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
  const [preset, setPreset] = useState("m6")

  const minMax = useMemo(() => {
    const ds = [...sales.map(saleDate), ...cashflow.map(m => (m.date || "").slice(0, 10))].filter(Boolean).sort()
    return { min: ds[0] || "2024-01-01", max: ds[ds.length - 1] || iso(new Date()) }
  }, [sales, cashflow])
  const range = useMemo(() => rangeFor(preset, minMax.min, minMax.max), [preset, minMax])
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

  // ---- Facturación + volumen por mes ----
  const byMonth = useMemo(() => {
    const m = new Map<string, { fact: number; m2: number }>()
    for (const s of sales) {
      const d = saleDate(s); if (!inRange(d, range) || s.status === "Cancelado") continue
      const mk = d.slice(0, 7)
      const row = m.get(mk) ?? { fact: 0, m2: 0 }
      row.fact += billed(s)
      row.m2 += (s.items || []).filter(it => isPisoItem(it.sku)).reduce((x, it) => x + (Number(it.quantity) || 0), 0)
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
        <div className="text-sm text-muted-foreground">Performance · {range.from} a {range.to}</div>
        <div className="flex gap-1">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => setPreset(p.key)} className={cn("h-8 px-3 text-xs rounded-md border", preset === p.key ? "bg-foreground text-background border-foreground" : "border-input text-muted-foreground hover:text-foreground")}>{p.label}</button>
          ))}
        </div>
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
          <div className="text-sm font-medium mb-1">Facturación y volumen (m² piso) por mes</div>
          <FactChart data={byMonth} />
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

function FactChart({ data }: { data: { mk: string; fact: number; m2: number }[] }) {
  if (data.length === 0) return <div className="text-sm text-muted-foreground py-10 text-center">Sin datos en el período</div>
  const W = 600, H = 200, padB = 24, padL = 4, padR = 4
  const maxF = Math.max(1, ...data.map(d => d.fact))
  const maxM2 = Math.max(1, ...data.map(d => d.m2))
  const bw = (W - padL - padR) / data.length
  const monthLbl = (mk: string) => ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][Number(mk.slice(5, 7)) - 1] + " " + mk.slice(2, 4)
  const linePts = data.map((d, i) => [padL + bw * i + bw / 2, (H - padB) - (d.m2 / maxM2) * (H - padB - 10)] as [number, number])
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: data.length * 48 }}>
        {data.map((d, i) => {
          const h = (d.fact / maxF) * (H - padB - 10)
          return <g key={i}>
            <rect x={padL + bw * i + bw * 0.15} y={(H - padB) - h} width={bw * 0.7} height={h} rx={2} className="fill-foreground/80" />
            <text x={padL + bw * i + bw / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9 }}>{monthLbl(d.mk)}</text>
          </g>
        })}
        <polyline points={linePts.map(p => p.join(",")).join(" ")} fill="none" stroke="#e4a368" strokeWidth={2} />
        {linePts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill="#e4a368" />)}
      </svg>
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground mt-1 px-1">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-foreground/80" />Facturación (US$)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3" style={{ background: "#e4a368" }} />m² de piso</span>
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
