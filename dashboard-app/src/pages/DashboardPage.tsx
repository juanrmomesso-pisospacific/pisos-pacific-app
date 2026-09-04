import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Card } from "@/components/ui/card"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ArrowUp, ArrowDown, Minus, LineChart, BarChart3 } from "lucide-react"
import { useApi } from "@/lib/api"
import { DataState } from "@/components/ui/data-state"
import { usePeriod } from "@/contexts/PeriodContext"
import { QuickPeriod } from "@/components/QuickPeriod"
import { fmtMoney, fmtInt, cn, appLocale } from "@/lib/utils"
import type { Sale, CashflowMovement, Product, Quote, CajaBalance } from "@/lib/types"
import { useModules, moduleOn } from "@/contexts/ConfigContext"
import { saldoDe, cobradoPct, cobranzaNivel, finalizadaEl, type CobranzaNivel } from "@/lib/sales"
import { useAuth } from "@/contexts/AuthContext"

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
// Comparativa honesta para períodos en curso: si el rango llega más allá de hoy (ej. "Este mes"
// al día 6), el delta se calcula contra los MISMOS días transcurridos del período anterior —
// comparar 6 días contra un mes completo daba siempre rojo. Para un mes calendario en curso,
// el "anterior" son los mismos días del mes pasado (1 al N), no la ventana inmediata previa.
function comparableRanges(r: Range, today: string): { cur: Range; prev: Range; partial: boolean } {
  const effTo = r.to > today ? today : r.to
  const cur = { from: r.from, to: effTo }
  const partial = effTo < r.to
  const from = new Date(r.from + "T12:00:00"), to = new Date(r.to + "T12:00:00")
  const sameMonth = r.from.slice(0, 7) === r.to.slice(0, 7)
  const isCalendarMonth = sameMonth && from.getDate() === 1 && to.getDate() === new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate()
  if (partial && isCalendarMonth) {
    const pm = new Date(from.getFullYear(), from.getMonth() - 1, 1)
    const lastDay = new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate()
    const day = Math.min(Number(effTo.slice(8, 10)), lastDay)
    return { cur, prev: { from: ymd(pm), to: ymd(new Date(pm.getFullYear(), pm.getMonth(), day)) }, partial }
  }
  return { cur, prev: prevRange(cur), partial }
}

// Desde esta fecha la cobertura de costos por venta es completa (backfill 2026).
// Antes: solo ventas con SKU tenían costo → el P&L devengado no cierra. Es histórico (ver caja).
const DEVENGADO_DESDE = "2026-01-01"
// Fecha de calendario de la venta, robusta a dos formatos de `created_at`:
//  · NOMINAL (importada/migrada): sin hora o medianoche UTC exacta ("2026-05-01T00:00:00.000Z") →
//    es una fecha de calendario, se toma TAL CUAL (mayo 1 = mayo). Convertirla a local la correría
//    a abril 30 (ARG es UTC−3) y falsearía el volumen/facturación por mes.
//  · TIMESTAMP REAL (con hora, ej. "2026-07-01T02:30Z" = 30-jun 23:30 ARG) → fecha LOCAL, así una
//    venta creada a la tarde/noche cae en su mes real y no se corre un día por el UTC (era el bug
//    de "aparece en Este mes pero no en Últimos 3 meses").
const saleDate = (s: Sale) => {
  const iso = s.created_at || ""
  if (!iso) return ""
  if (!iso.includes("T") || /T00:00:00(\.0+)?Z?$/.test(iso)) return iso.slice(0, 10)
  const t = new Date(iso)
  return isNaN(+t) ? iso.slice(0, 10) : ymd(t)
}
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
  // Bloques financieros (gastos/neto, que salen del cashflow) solo si la operación usa finanzas.
  const modules = useModules()
  const dashFinOn = moduleOn(modules, "dashboard_finanzas") && moduleOn(modules, "finanzas")
  const salesApi = useApi<Sale[]>("/api/sales")
  const sales = salesApi.data ?? []
  const cashflow = useApi<CashflowMovement[]>("/api/cashflow").data ?? []
  const products = useApi<Product[]>("/api/products").data ?? []
  const quotes = useApi<Quote[]>("/api/quotes").data ?? []
  // Saldos de caja: solo admin los ve (los vendedores tienen el resto del dashboard).
  const { state: auth } = useAuth()
  const isAdmin = auth.user?.role === "admin"
  const cajaBalances = useApi<{ balances: CajaBalance[] }>("/api/cajas/balances").data?.balances ?? []
  const { range: gRange } = usePeriod()
  const navigate = useNavigate()
  const [chartMode, setChartMode] = useState<"line" | "bar">(() => (typeof window !== "undefined" && window.localStorage.getItem("dash:chart") === "bar") ? "bar" : "line")
  const setChart = (m: "line" | "bar") => { setChartMode(m); if (typeof window !== "undefined") window.localStorage.setItem("dash:chart", m) }

  // Cobertura de costos completa desde acá → el análisis devengado no va más atrás
  // (antes el costo no está cargado y el margen/neto pierde sentido).
  const rawFrom = ymd(gRange.from), to = ymd(gRange.to)
  const clamped = rawFrom < DEVENGADO_DESDE
  const range = useMemo(() => ({ from: clamped ? DEVENGADO_DESDE : rawFrom, to }), [rawFrom, to, clamped])
  const today = ymd(new Date())
  const cmp = useMemo(() => comparableRanges(range, today), [range, today])
  const prev = cmp.prev

  // Producto piso (m²): por stockTrack y activo. Mapa sku→producto.
  const prodBySku = useMemo(() => { const m = new Map<string, Product>(); for (const p of products) m.set(p.sku, p); return m }, [products])
  const isPisoItem = (sku?: string) => { const p = sku ? prodBySku.get(sku) : undefined; return !!p && !!p.stockTrack && p.kind !== "panel" && p.active !== false }
  // Colocadores: su mano de obra ya está en el costo de servicio → se excluye del opex.
  // Match NORMALIZADO (sin mayúsculas/acentos) + por primer nombre cuando la contraparte es
  // de una sola palabra (ej. "Hugo" matchea "Hugo Ramirez") → evita doble conteo por nombres
  // que no coinciden exacto, que era la causa de que la mano de obra se contara dos veces.
  const settings = useApi<{ installers?: string[]; anticipo_pct?: number; dashboardThresholds?: { overdueCobroDays?: number; conversionWindowDays?: number; lowStockUnits?: number } }>("/api/settings").data
  // Umbrales del engranaje del header (ThresholdSettings): con defaults razonables.
  const anticipoPct = settings?.anticipo_pct ?? 0.8
  const overdueCobroDays = settings?.dashboardThresholds?.overdueCobroDays || 30
  const conversionWindowDays = settings?.dashboardThresholds?.conversionWindowDays || 90
  const lowStockUnits = settings?.dashboardThresholds?.lowStockUnits || 5
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim()
  const installerNorms = useMemo(() => (settings?.installers ?? []).map(norm).filter(Boolean), [settings])
  const isInstaller = useMemo(() => {
    const full = new Set(installerNorms)
    const firsts = new Set(installerNorms.map(n => n.split(" ")[0]))   // primer nombre
    return (cp?: string | null) => {
      const n = norm(cp || ""); if (!n) return false
      if (full.has(n)) return true
      return !n.includes(" ") && firsts.has(n)   // contraparte de una sola palabra = primer nombre del colocador
    }
  }, [installerNorms])

  // ---- Métricas por período (alineadas al P&L híbrido) ----
  const metrics = (r: Range) => {
    const inP = sales.filter(s => inRange(saleDate(s), r) && s.status !== "Cancelado")
    const fact = inP.reduce((a, s) => a + billed(s), 0)
    const detailed = inP.filter(s => s.has_sku_detail && s.margin_bd)
    // Bruto "obra completo" = ingresos (piso+servicio+extras) − costos bloqueados − insumos generales de colocación.
    let ingV = 0, costV = 0
    for (const s of detailed) for (const k of ["piso", "servicio", "extras", "panel"] as const) { ingV += s.margin_bd![k]?.rev || 0; costV += s.margin_bd![k]?.cost || 0 }
    const opex = cashflow.filter(m => m.flow === "Egreso" && !m.transfer && inRange((m.date || "").slice(0, 10), r) && (m.expense_type || "") !== "COGS")
    let insumosColoc = 0, opexTotal = 0
    for (const m of opex) {
      if (isInstaller(m.counterparty)) continue
      if ((m.expense_type || "") === "Gastos de Instalaciones y Suministros") insumosColoc += m.amount_usd || 0
      else opexTotal += m.amount_usd || 0
    }
    const grossProfit = ingV - costV - insumosColoc
    const grossPct = ingV ? grossProfit / ingV : NaN
    const m2 = inP.reduce((a, s) => a + (s.items || []).filter(it => isPisoItem(it.sku)).reduce((x, it) => x + (Number(it.quantity) || 0), 0), 0)
    // Comisiones a revendedores: costo real que baja el margen (arqs por %, mayoristas por lista).
    const comisiones = inP.reduce((a, s) => a + (Number(s.commission_amount) || 0), 0)
    const neto = grossProfit - opexTotal - comisiones
    // Cobrado (caja) del período: ingresos reales de ventas — linkeados a una venta o
    // clasificados como Venta. La brecha vs. facturación es la alerta temprana de cobranza.
    const cobradoCaja = cashflow.reduce((a, m) => {
      if (m.flow !== "Ingreso" || m.transfer || !inRange((m.date || "").slice(0, 10), r)) return a
      if (!m.sale_ref && !(m.category || "").startsWith("Venta")) return a
      return a + (m.amount_usd || 0)
    }, 0)
    // Cobertura de costos: qué parte de la facturación tiene costo bloqueado (honestidad del margen).
    const factConCosto = detailed.reduce((a, s) => a + billed(s), 0)
    return { fact, grossProfit, grossPct, m2, opexTotal, comisiones, neto, cobradoCaja, factConCosto, count: inP.length, detailedCount: detailed.length, opex }
  }
  const cur = useMemo(() => metrics(range), [sales, cashflow, products, range, isInstaller])
  const pre = useMemo(() => metrics(prev), [sales, cashflow, products, prev, isInstaller])

  // ---- Cobranzas por nivel de relevancia (no depende del período: estado actual) ----
  // Regla del dueño (6/8): la antigüedad de la venta NO mide mora (hay obras que pagan el
  // anticipo y colocan a +90 días). Prioriza estado de obra vs. cobrado — ver cobranzaNivel().
  const cobranzas = useMemo(() => {
    const por: Record<CobranzaNivel, { list: Sale[]; total: number }> = {
      entregada: { list: [], total: 0 }, anticipo: { list: [], total: 0 }, esperando: { list: [], total: 0 },
    }
    for (const s of sales) {
      const nivel = cobranzaNivel(s, anticipoPct)
      if (!nivel) continue
      por[nivel].list.push(s); por[nivel].total += saldoDe(s)
    }
    for (const k of Object.keys(por) as CobranzaNivel[]) por[k].list.sort((a, b) => saldoDe(b) - saldoDe(a))
    const total = por.entregada.total + por.anticipo.total + por.esperando.total
    const count = por.entregada.list.length + por.anticipo.list.length + por.esperando.list.length
    // Top accionable: primero obra entregada sin cobrar, después anticipos incompletos.
    const top = [...por.entregada.list, ...por.anticipo.list].slice(0, 8)
    return { por, total, count, top }
  }, [sales, anticipoPct])
  const pendiente = { total: cobranzas.total, count: cobranzas.count }

  // ---- Caja (solo admin + finanzas): saldo consolidado + neto del período ----
  const caja = useMemo(() => {
    const total = cajaBalances.reduce((a, b) => a + (b.balance_usd || 0), 0)
    const porCaja = [...cajaBalances].filter(b => b.movements > 0 || Math.abs(b.balance_usd) > 0.5).sort((a, b) => b.balance_usd - a.balance_usd)
    let inP = 0, outP = 0
    for (const m of cashflow) {
      if (m.transfer || !inRange((m.date || "").slice(0, 10), range)) continue
      if (m.flow === "Ingreso") inP += m.amount_usd || 0; else outP += m.amount_usd || 0
    }
    return { total, porCaja, inP, outP, neto: inP - outP }
  }, [cajaBalances, cashflow, range])

  // ---- Embudo comercial: cotizaciones abiertas + conversión ----
  const embudo = useMemo(() => {
    const isOpen = (q: Quote) => ["SENT", "Enviado"].includes(q.status)
    const isAccepted = (q: Quote) => ["ACCEPTED", "Aceptado"].includes(q.status)
    const isDraft = (q: Quote) => ["DRAFT", "Borrador"].includes(q.status)
    const abiertas = quotes.filter(isOpen)
    const abiertasTotal = abiertas.reduce((a, q) => a + (Number(q.price) || 0), 0)
    const cut = new Date(); cut.setDate(cut.getDate() - 7)
    const frias = abiertas.filter(q => new Date(q.renewed_at || q.created_at) < cut)
    // Conversión en la ventana configurable: aceptadas / emitidas (sin borradores).
    const wCut = new Date(); wCut.setDate(wCut.getDate() - conversionWindowDays)
    const emitidas = quotes.filter(q => !isDraft(q) && new Date(q.created_at) >= wCut)
    const conv = emitidas.length ? emitidas.filter(isAccepted).length / emitidas.length : NaN
    return { abiertas: abiertas.length, abiertasTotal, frias: frias.length, conv, emitidas: emitidas.length }
  }, [quotes, conversionWindowDays])

  // ---- Facturación + volumen por mes (con desglose por categoría para la vista apilada) ----
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
    const cat = { piso: { rev: 0, cost: 0 }, servicio: { rev: 0, cost: 0 }, extras: { rev: 0, cost: 0 }, panel: { rev: 0, cost: 0 } }
    // Comisiones a revendedores del período (bajan el margen, tanto arqs % como mayoristas por lista).
    let comisiones = 0
    for (const s of sales) {
      if (!inRange(saleDate(s), range) || s.status === "Cancelado") continue
      comisiones += Number(s.commission_amount) || 0   // cuenta con o sin margin_bd
      if (!s.margin_bd) continue
      for (const k of ["piso", "servicio", "extras", "panel"] as const) {
        cat[k].rev += s.margin_bd[k]?.rev || 0; cat[k].cost += s.margin_bd[k]?.cost || 0
      }
    }
    // Egresos del cashflow del período. Colocadores (installerSet) → ya en costo de servicio, se excluyen.
    const opexBy: Record<string, number> = {}
    let insumosColoc = 0
    for (const m of cur.opex) {
      const cp = (m.counterparty || "").trim()
      if (isInstaller(cp)) continue // mano de obra de colocación: ya está en Costo Servicio
      const t = m.expense_type || "Otros Gastos y Ajustes"
      if (t === "Gastos de Instalaciones y Suministros") { insumosColoc += m.amount_usd || 0; continue }
      opexBy[t] = (opexBy[t] || 0) + (m.amount_usd || 0)
    }
    const ingresos = cat.piso.rev + cat.servicio.rev + cat.extras.rev + cat.panel.rev
    const costos = cat.piso.cost + cat.servicio.cost + cat.extras.cost + cat.panel.cost + insumosColoc
    return { cat, insumosColoc, comisiones, ingresos, costos, bruta: ingresos - costos, opexBy }
  }, [cur, sales, range, isInstaller])

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

  // ---- Cobertura de stock (decisión de reposición: lead time de contenedor ~3-4 meses) ----
  // Venta mensual promedio por SKU (últimos 90 días, independiente del período elegido) vs.
  // disponible → meses de cobertura. Lo crítico (disponible ≤ umbral) entra siempre.
  const stockCobertura = useMemo(() => {
    const cut = new Date(); cut.setDate(cut.getDate() - 90)
    const cutISO = ymd(cut)
    const m2PorSku = new Map<string, number>()
    for (const s of sales) {
      if (s.status === "Cancelado" || saleDate(s) < cutISO) continue
      for (const it of s.items || []) {
        if (!it.sku || !isPisoItem(it.sku)) continue
        m2PorSku.set(it.sku, (m2PorSku.get(it.sku) || 0) + (Number(it.quantity) || 0))
      }
    }
    const rows = products.filter(p => p.active !== false && p.stockTrack).map(p => {
      const stock = Number(p.stock) || 0, reserved = Number(p.committed ?? p.reservedStock) || 0
      const available = stock - reserved
      const mensual = (m2PorSku.get(p.sku) || 0) / 3
      const meses = mensual > 0 ? Math.max(0, available) / mensual : Infinity
      // Orden: sobre-vendidos primero (disponible ≤ 0 es lo más urgente, venda o no), después por cobertura.
      const urgencia = available <= 0 ? available : meses
      return { p, stock, reserved, available, mensual, meses, urgencia }
    }).filter(x => x.mensual > 0 || x.available <= lowStockUnits)
      .sort((a, b) => a.urgencia - b.urgencia)
    return { rows: rows.slice(0, 10), criticos: rows.filter(x => x.available <= lowStockUnits).length }
  }, [products, sales, lowStockUnits])

  // ---- Margen por obra (top y bottom) ----
  const porObra = useMemo(() => {
    const list = sales.filter(s => inRange(saleDate(s), range) && s.status !== "Cancelado" && s.has_sku_detail && s.margin != null)
      .map(s => ({ s, margin: s.margin || 0, pct: s.margin_pct ?? null }))
      .sort((a, b) => b.margin - a.margin)
    return { top: list.slice(0, 5), bottom: list.slice(-5).reverse() }
  }, [sales, range])

  const delta = (c: number, p: number) => p === 0 ? null : { pct: (c - p) / Math.abs(p), up: c >= p }

  return (
   <DataState loading={salesApi.loading} error={salesApi.error} hasData={sales.length > 0} onRetry={salesApi.refetch}>
    <div className="px-4 lg:px-6 space-y-4">
      {/* Período */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-muted-foreground">
          Performance · {gRange.label} · {range.from} a {range.to}
          {clamped && <span className="ml-2 text-[11px] text-amber-600">· análisis devengado desde ene-2026 (cobertura de costos)</span>}
          {cmp.partial && <span className="ml-2 text-[11px]">· período en curso: Δ vs. mismos días del anterior</span>}
        </div>
        <QuickPeriod />
      </div>

      {/* KPIs — sin módulo finanzas no hay caja: "Resultado neto"/"Cobrado" no aplican → m² + pendiente */}
      <div className="grid grid-cols-1 sm:grid-cols-2 @4xl/main:grid-cols-4 gap-3">
        <Kpi label="Facturación" value={fmtMoney(cur.fact)} sub={`${cur.count} ventas`} delta={delta(cur.fact, pre.fact)} onClick={() => navigate("/ventas")} />
        <Kpi label="Margen bruto" value={fmtMoney(cur.grossProfit)}
          sub={isFinite(cur.grossPct) ? `${(cur.grossPct * 100).toFixed(1)}% · costo en ${cur.fact ? Math.round(cur.factConCosto / cur.fact * 100) : 0}% de la fact.` : "sin costo cargado"}
          warnSub={cur.fact > 0 && cur.factConCosto / cur.fact < 0.7}
          delta={delta(cur.grossProfit, pre.grossProfit)} onClick={() => navigate("/reportes")} />
        {dashFinOn
          ? <Kpi label="Resultado neto" value={fmtMoney(cur.neto)} sub={`bruto − gastos (${fmtMoney(cur.opexTotal)})`} delta={delta(cur.neto, pre.neto)} />
          : <Kpi label="m² vendidos" value={fmtInt(cur.m2)} sub="m² de piso en el período" delta={delta(cur.m2, pre.m2)} />}
        {dashFinOn
          ? <Kpi label="Cobrado (caja)" value={fmtMoney(cur.cobradoCaja)}
              sub={cur.fact > 0 ? `${Math.round(cur.cobradoCaja / cur.fact * 100)}% de lo facturado` : "cobros de ventas del período"}
              warnSub={cur.fact > 0 && cur.cobradoCaja / cur.fact < 0.5}
              delta={delta(cur.cobradoCaja, pre.cobradoCaja)} onClick={() => navigate("/cashflow")} />
          : <Kpi label="Pendiente de cobro" value={fmtMoney(pendiente.total)} sub={`${pendiente.count} ventas`} delta={null} onClick={() => navigate("/ventas")} />}
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
          <div className="text-[10px] text-muted-foreground mb-1">{dashFinOn ? "Por ventas con costo bloqueado. La vista de caja está en CashFlow → Análisis Financiero." : "Por ventas con costo bloqueado."}</div>
          <PnlMini pnl={pnl} showOpex={dashFinOn} />
        </Card>
      </div>

      {/* Cobranzas por relevancia | Caja + Embudo */}
      <div className="grid grid-cols-1 @4xl/main:grid-cols-3 gap-4">
        <CobranzasCard cobranzas={cobranzas} overdueDays={overdueCobroDays} anticipoPct={anticipoPct}
          onOpenSale={(id) => navigate(`/ventas?sale=${id}`)} />
        <div className="space-y-4">
          {dashFinOn && isAdmin && <CajaCard caja={caja} onClick={() => navigate("/cajas")} />}
          <EmbudoCard embudo={embudo} windowDays={conversionWindowDays} onClick={() => navigate("/cotizaciones")} />
        </div>
      </div>

      {/* Top pisos | Cobertura de stock */}
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
          <div className="px-4 py-3 text-sm font-medium border-b border-border flex items-center justify-between">
            <span>Cobertura de stock <span className="text-[11px] font-normal text-muted-foreground">· venta prom. últimos 90 días</span></span>
            <Badge variant="outline" className={cn("text-[10px]", stockCobertura.criticos > 0 && "text-destructive border-destructive/40")}>{stockCobertura.criticos} críticos</Badge>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Producto</TableHead><TableHead className="text-right">Disponible</TableHead><TableHead className="text-right">m²/mes</TableHead><TableHead className="text-right">Cobertura</TableHead></TableRow></TableHeader>
            <TableBody>
              {stockCobertura.rows.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">Sin ventas recientes ni faltantes</TableCell></TableRow>
                : stockCobertura.rows.map(({ p, available, mensual, meses }) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-[240px] truncate">{p.name}</TableCell>
                    <TableCell className={cn("text-right tabular", available <= 0 && "text-destructive font-medium")}>{fmtInt(available)}</TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{mensual > 0 ? fmtInt(mensual) : "—"}</TableCell>
                    <TableCell className={cn("text-right tabular font-medium", available < 0 ? "text-destructive" : !isFinite(meses) ? "text-muted-foreground" : meses < 2 ? "text-destructive" : meses < 4 ? "text-amber-600" : "text-muted-foreground")}>
                      {available < 0 ? "sobre-vendido" : isFinite(meses) ? `${meses.toFixed(1)} m` : "sin venta"}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <div className="px-4 pb-3 text-[10px] text-muted-foreground">Cobertura = disponible ÷ venta mensual. Rojo &lt; 2 meses, ámbar &lt; 4 (lead time de reposición por contenedor).</div>
        </Card>
      </div>

      {/* Margen por obra */}
      <div className="grid grid-cols-1 @4xl/main:grid-cols-2 gap-4">
        <ObraTable title="Mejores márgenes (obra)" rows={porObra.top} />
        <ObraTable title="Márgenes más bajos (obra)" rows={porObra.bottom} />
      </div>
      {dashFinOn && (
        <div className="text-[11px] text-muted-foreground pb-4">
          <b>P&amp;L devengado:</b> ingresos y costos (Piso/Servicio/Extras) desde ventas con costo bloqueado al confirmar; insumos generales de colocación y gastos desde la planilla/cashflow. La mano de obra de colocadores ya está en el costo de servicio (no se cuenta dos veces). Productos inactivos excluidos. Para el resultado de caja completo (incluye Paneles): CashFlow → Análisis Financiero.
        </div>
      )}
    </div>
   </DataState>
  )
}

function Kpi({ label, value, sub, delta, warnSub, onClick }: { label: string; value: string; sub?: string; delta: { pct: number; up: boolean } | null; warnSub?: boolean; onClick?: () => void }) {
  const Icon = delta == null ? Minus : delta.up ? ArrowUp : ArrowDown
  return (
    <Card className={cn("p-4 gap-1", onClick && "cursor-pointer transition-colors hover:bg-muted/40")} onClick={onClick}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center justify-between">
        {label}
        {delta != null && <span className={cn("inline-flex items-center gap-0.5 text-[10px]", delta.up ? "text-emerald-600" : "text-destructive")}><Icon className="h-3 w-3" />{Math.abs(delta.pct * 100).toFixed(0)}%</span>}
      </div>
      <div className="text-2xl font-semibold serif tabular">{value}</div>
      {sub && <div className={cn("text-[11px]", warnSub ? "text-amber-600" : "text-muted-foreground")}>{sub}</div>}
    </Card>
  )
}

// ---- Cobranzas por relevancia ----
const NIVEL_META: Record<CobranzaNivel, { dot: string; label: string; hint: string }> = {
  entregada: { dot: "bg-destructive", label: "Obra entregada sin cobrar", hint: "colocamos y la plata está afuera — cobrar YA" },
  anticipo:  { dot: "bg-amber-500",   label: "Anticipo incompleto",       hint: "confirmada (con stock reservado) sin el anticipo completo" },
  esperando: { dot: "bg-muted-foreground/40", label: "Esperando obra",    hint: "anticipo pagado, falta el conforme — no es mora" },
}
type CobranzasData = { por: Record<CobranzaNivel, { list: Sale[]; total: number }>; total: number; count: number; top: Sale[] }

function CobranzasCard({ cobranzas, overdueDays, anticipoPct, onOpenSale }: { cobranzas: CobranzasData; overdueDays: number; anticipoPct: number; onOpenSale: (id: string) => void }) {
  const today = new Date()
  const diasDesde = (iso: string | null) => iso ? Math.max(0, Math.round((+today - +new Date(iso + "T12:00:00")) / 86400000)) : null
  return (
    <Card className="@4xl/main:col-span-2 overflow-hidden py-0">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-medium">Cobranzas · <span className="tabular">{fmtMoney(cobranzas.total)}</span> <span className="text-muted-foreground font-normal">en {cobranzas.count} ventas</span></div>
        <div className="flex items-center gap-3 text-[11px]">
          {(Object.keys(NIVEL_META) as CobranzaNivel[]).map(k => (
            <span key={k} className="inline-flex items-center gap-1.5" title={NIVEL_META[k].hint}>
              <span className={cn("h-2 w-2 rounded-full", NIVEL_META[k].dot)} />
              <span className="text-muted-foreground">{NIVEL_META[k].label}</span>
              <span className="tabular font-medium">{fmtMoney(cobranzas.por[k].total)}</span>
            </span>
          ))}
        </div>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Obra</TableHead><TableHead>Situación</TableHead><TableHead className="text-right">Cobrado</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
        <TableBody>
          {cobranzas.top.length === 0
            ? <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">Sin cobranzas urgentes — lo pendiente está esperando obra</TableCell></TableRow>
            : cobranzas.top.map(s => {
              const nivel = s.status === "Finalizado" ? "entregada" as const : "anticipo" as const
              const fin = nivel === "entregada" ? finalizadaEl(s) : null
              const dias = fin ? diasDesde(fin) : null
              return (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => onOpenSale(s.id)}>
                  <TableCell className="max-w-[260px] truncate">{s.title || s.client_name}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className={cn("h-2 w-2 rounded-full shrink-0", NIVEL_META[nivel].dot)} />
                      {nivel === "entregada"
                        ? <span className={cn(dias != null && dias > overdueDays && "text-destructive font-medium")}>{dias != null ? `entregada hace ${dias} días` : "entregada"}</span>
                        : <span className="text-muted-foreground">{s.status}</span>}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">{Math.round(cobradoPct(s) * 100)}%</TableCell>
                  <TableCell className="text-right tabular font-medium">{fmtMoney(saldoDe(s))}</TableCell>
                </TableRow>
              )
            })}
        </TableBody>
      </Table>
      {cobranzas.por.esperando.list.length > 0 && (
        <div className="px-4 pb-3 text-[10px] text-muted-foreground">
          + {cobranzas.por.esperando.list.length} ventas esperando obra ({fmtMoney(cobranzas.por.esperando.total)}) con el anticipo (≥{Math.round(anticipoPct * 100)}%) pagado — sin urgencia.
        </div>
      )}
    </Card>
  )
}

// ---- Caja ----
type CajaData = { total: number; porCaja: CajaBalance[]; inP: number; outP: number; neto: number }
function CajaCard({ caja, onClick }: { caja: CajaData; onClick: () => void }) {
  return (
    <Card className="p-4 gap-2 cursor-pointer transition-colors hover:bg-muted/40" onClick={onClick}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Caja consolidada</div>
      <div className="text-2xl font-semibold serif tabular">{fmtMoney(caja.total)}</div>
      <div className={cn("text-[11px]", caja.neto < 0 ? "text-destructive" : "text-emerald-600")}>
        {caja.neto >= 0 ? "+" : ""}{fmtMoney(caja.neto)} neto del período <span className="text-muted-foreground">(↑{fmtMoney(caja.inP)} · ↓{fmtMoney(caja.outP)})</span>
      </div>
      <div className="mt-1 space-y-0.5">
        {caja.porCaja.map(b => (
          <div key={b.caja_id} className="flex justify-between text-xs">
            <span className="text-muted-foreground truncate pr-2">{b.name}</span>
            <span className={cn("tabular", b.balance_usd < 0 && "text-destructive")}>{fmtMoney(b.balance_usd)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---- Embudo comercial ----
type EmbudoData = { abiertas: number; abiertasTotal: number; frias: number; conv: number; emitidas: number }
function EmbudoCard({ embudo, windowDays, onClick }: { embudo: EmbudoData; windowDays: number; onClick: () => void }) {
  return (
    <Card className="p-4 gap-2 cursor-pointer transition-colors hover:bg-muted/40" onClick={onClick}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Embudo comercial</div>
      <div className="text-2xl font-semibold serif tabular">{fmtMoney(embudo.abiertasTotal)}</div>
      <div className="text-[11px] text-muted-foreground">{embudo.abiertas} cotizaciones abiertas (enviadas sin respuesta)</div>
      <div className="space-y-0.5 mt-1 text-xs">
        <div className="flex justify-between"><span className="text-muted-foreground">Sin respuesta hace +7 días</span><span className={cn("tabular", embudo.frias > 0 && "text-amber-600 font-medium")}>{embudo.frias}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Conversión últimos {windowDays} días</span><span className="tabular">{isFinite(embudo.conv) ? Math.round(embudo.conv * 100) + "%" : "—"}<span className="text-muted-foreground"> · {embudo.emitidas} emitidas</span></span></div>
      </div>
    </Card>
  )
}

type ChartRow = { mk: string; fact: number; m2: number }
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
const fmtM2 = (v: number) => (isFinite(v) ? Math.round(v).toLocaleString(appLocale()) : "0") + " m²"
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
  cat: { piso: { rev: number; cost: number }; servicio: { rev: number; cost: number }; extras: { rev: number; cost: number }; panel: { rev: number; cost: number } }
  insumosColoc: number; comisiones: number; ingresos: number; costos: number; bruta: number; opexBy: Record<string, number>
}
// showOpex=false (operación sin módulo finanzas): no hay gastos de caja cargados, así que el
// estado corta en la ganancia bruta (mostrar "gastos $0 → neto=bruta" sería engañoso).
function PnlMini({ pnl, showOpex = true }: { pnl: Pnl; showOpex?: boolean }) {
  const opexTotal = OPEX_ORDER.reduce((a, t) => a + (pnl.opexBy[t] || 0), 0)
  const neto = pnl.bruta - opexTotal - pnl.comisiones
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
      {pnl.cat.panel.rev > 0 && <Line l="Paneles (ACUDESIGN)" v={pnl.cat.panel.rev} indent />}
      <Line l="Ingresos totales" v={pnl.ingresos} bold />
      <Head l="Costos" />
      <Line l="Costo piso" v={-pnl.cat.piso.cost} muted indent />
      <Line l="Costo servicio" v={-pnl.cat.servicio.cost} muted indent />
      <Line l="Costo extras" v={-pnl.cat.extras.cost} muted indent />
      {pnl.cat.panel.cost > 0 && <Line l="Costo paneles" v={-pnl.cat.panel.cost} muted indent />}
      <Line l="Insumos grales. colocación" v={-pnl.insumosColoc} muted indent />
      <Line l={`Ganancia bruta · ${isFinite(brutoPct) ? (brutoPct * 100).toFixed(0) + "%" : "—"}`} v={pnl.bruta} bold />
      {showOpex && (
        <>
          <Head l="Gastos" />
          {OPEX_ORDER.filter(t => pnl.opexBy[t]).map(t => <Line key={t} l={t.replace("Gastos de ", "").replace(" (HR y Mano de Obra)", "")} v={-(pnl.opexBy[t] || 0)} muted indent />)}
          {pnl.comisiones > 0 && <Line l="Comisiones a revendedores" v={-pnl.comisiones} muted indent />}
          <Line l={`Resultado neto · ${isFinite(netoPct) ? (netoPct * 100).toFixed(0) + "%" : "—"}`} v={neto} bold />
        </>
      )}
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
