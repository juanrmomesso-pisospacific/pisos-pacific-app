import { useMemo } from "react"
import { Users, FileText, CheckCircle2, TrendingUp, ArrowDownRight, Crown, AlertCircle, Clock, Wallet, Percent, Boxes } from "lucide-react"
import { Link } from "react-router-dom"
import { Area, XAxis, YAxis, CartesianGrid, AreaChart } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { useApi } from "@/lib/api"
import { usePeriod } from "@/contexts/PeriodContext"
import { QuickPeriod } from "@/components/QuickPeriod"
import { useRole } from "@/contexts/RoleContext"
import { inRange, fmtRange, lastNMonths } from "@/lib/period"
import { fmtMoney } from "@/lib/utils"
import { type Lead, STATUS_ORDER as LEAD_ORDER, STATUS_LABEL as LEAD_LABEL } from "@/lib/leads"
import type { Quote, Sale, Product } from "@/lib/types"

const ACTIVE_SALE_STATUSES = new Set(["Confirmado", "Programado", "En proceso", "Finalizado"])

export default function ReportesPage() {
  return (
    <div className="px-4 lg:px-6">
      <Tabs defaultValue="funnel">
        <TabsList>
          <TabsTrigger value="funnel">Embudo de conversión</TabsTrigger>
          <TabsTrigger value="vendors">Vendedores</TabsTrigger>
          <TabsTrigger value="margin">Margen</TabsTrigger>
          <TabsTrigger value="aging">Cobros</TabsTrigger>
        </TabsList>
        <TabsContent value="funnel" className="mt-4">
          <FunnelReport />
        </TabsContent>
        <TabsContent value="vendors" className="mt-4">
          <VendorReport />
        </TabsContent>
        <TabsContent value="margin" className="mt-4">
          <MarginReport />
        </TabsContent>
        <TabsContent value="aging" className="mt-4">
          <AgingReport />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function FunnelReport() {
  const { range } = usePeriod()
  const { role } = useRole()
  const sellerScope = role.kind === "vendor" ? role.sellerName : null

  const leads    = useApi<Lead[]>("/api/leads").data    ?? []
  const quotes   = useApi<Quote[]>("/api/quotes").data  ?? []
  const sales    = useApi<Sale[]>("/api/sales").data    ?? []

  const data = useMemo(() => {
    // -------- Leads in scope --------
    const periodLeads = leads.filter(l => {
      if (!inRange(l.created_at, range)) return false
      if (sellerScope && l.assigned_seller !== sellerScope) return false
      return true
    })
    const leadByStatus: Record<string, number> = { New: 0, Contacted: 0, Quoted: 0, Won: 0, Lost: 0 }
    for (const l of periodLeads) leadByStatus[l.status] = (leadByStatus[l.status] ?? 0) + 1
    // Cumulative funnel — "at-least-this-stage" counts. We treat Lost as leads that
    // exited the funnel from wherever, so they don't appear in the advance counts.
    const leadStages: FunnelStage[] = [
      { key: "leads",      label: "Leads ingresados", count: periodLeads.filter(l => l.status !== "Lost").length, total: periodLeads.length },
      { key: "contacted",  label: "Contactados",      count: periodLeads.filter(l => ["Contacted","Quoted","Won"].includes(l.status)).length },
      { key: "quoted",     label: "Cotizados",        count: periodLeads.filter(l => ["Quoted","Won"].includes(l.status)).length },
      { key: "won",        label: "Ganados",          count: periodLeads.filter(l => l.status === "Won").length },
    ]

    // -------- Quotes in scope --------
    const periodQuotes = quotes.filter(q => {
      if (!inRange(q.created_at, range)) return false
      if (sellerScope && q.seller_name !== sellerScope) return false
      return true
    })
    const sentOrFurther     = periodQuotes.filter(q => q.status === "Enviado" || q.status === "Aceptado" || q.status === "SENT" || q.status === "ACCEPTED" || q.status === "REJECTED")
    const acceptedOrFurther = periodQuotes.filter(q => q.status === "Aceptado" || q.status === "ACCEPTED")
    const converted         = periodQuotes.filter(q => q.sale_id)
    const quoteStages: FunnelStage[] = [
      { key: "qcreated",  label: "Cotizaciones creadas", count: periodQuotes.length },
      { key: "qsent",     label: "Enviadas",             count: sentOrFurther.length },
      { key: "qaccepted", label: "Aceptadas",            count: acceptedOrFurther.length },
      { key: "qconv",     label: "Convertidas a venta", count: converted.length },
    ]

    // -------- Top-line KPIs (period only) --------
    const periodSales = sales.filter(s => {
      if (!inRange(s.created_at, range)) return false
      if (sellerScope && s.seller_name !== sellerScope) return false
      if (!ACTIVE_SALE_STATUSES.has(s.status)) return false
      return true
    })
    const totalBilled = periodSales.reduce((sum, s) => sum + (s.contract_total ?? 0), 0)
    const totalPaid   = periodSales.reduce((sum, s) => sum + (s.financial_position?.total_paid ?? 0), 0)

    return {
      leadStages,
      quoteStages,
      kpis: {
        leadsTotal:  periodLeads.length,
        quotesTotal: periodQuotes.length,
        salesTotal:  periodSales.length,
        totalBilled,
        totalPaid,
        leadToWonRate:   safePct(leadStages[3].count, leadStages[0].count),
        quoteToWonRate:  safePct(quoteStages[3].count, quoteStages[0].count),
      },
      hasData: periodLeads.length + periodQuotes.length + periodSales.length > 0,
      leadByStatus,
    }
  }, [leads, quotes, sales, range, sellerScope])

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-muted-foreground">Período: {fmtRange(range)} {sellerScope ? `· Vendedor: ${sellerScope}` : "· Todos los vendedores"}</div>
        <QuickPeriod />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Users}        label="Leads"       value={data.kpis.leadsTotal.toString()} />
        <Kpi icon={FileText}     label="Cotizaciones" value={data.kpis.quotesTotal.toString()} />
        <Kpi icon={CheckCircle2} label="Ventas"      value={data.kpis.salesTotal.toString()} />
        <Kpi icon={TrendingUp}   label="Facturado"   value={fmtMoney(data.kpis.totalBilled)} />
      </div>

      {!data.hasData ? (
        <Card><CardContent className="text-sm text-muted-foreground py-10 text-center">Sin actividad en este período.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 @4xl/main:grid-cols-2 gap-4 md:gap-6">
          <FunnelCard
            title="Embudo de leads"
            description="Del primer contacto al cierre"
            stages={data.leadStages}
            footer={`Conversión global Lead → Ganado: ${fmtPct(data.kpis.leadToWonRate)}`}
            note={`${data.leadByStatus.Lost ?? 0} leads se marcaron como Perdido en el período (no se cuentan en el embudo).`}
          />
          <FunnelCard
            title="Embudo de cotizaciones"
            description="Ciclo de vida de la cotización"
            stages={data.quoteStages}
            footer={`Conversión Cotización → Venta: ${fmtPct(data.kpis.quoteToWonRate)}`}
          />
        </div>
      )}

      <LeadStatusBreakdown counts={data.leadByStatus} />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Funnel primitives
// -----------------------------------------------------------------------------

type FunnelStage = {
  key: string
  label: string
  count: number
  total?: number  // for "of N total" annotations
}

function FunnelCard({ title, description, stages, footer, note }: { title: string; description: string; stages: FunnelStage[]; footer: string; note?: string }) {
  const top = stages[0]?.count ?? 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {stages.map((s, i) => {
            const prev = i === 0 ? null : stages[i - 1]
            const pctOfTop = top > 0 ? (s.count / top) * 100 : 0
            const dropPct  = prev && prev.count > 0 ? 100 - (s.count / prev.count) * 100 : null
            const advancePct = prev && prev.count > 0 ? (s.count / prev.count) * 100 : null
            return (
              <div key={s.key} className="space-y-1">
                {prev != null && (
                  <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground py-0.5">
                    <ArrowDownRight className="h-3 w-3" />
                    <span className="tabular">{advancePct != null ? fmtPct(advancePct) : "—"}</span>
                    <span>avanza</span>
                    {dropPct != null && dropPct > 0 && <span className="text-destructive/80">· {fmtPct(dropPct)} se pierde</span>}
                  </div>
                )}
                <div className="rounded-md border border-border bg-card overflow-hidden">
                  <div className="relative h-12 flex items-center">
                    <div
                      className="absolute inset-y-0 left-0 bg-primary/10 transition-[width]"
                      style={{ width: `${Math.max(pctOfTop, s.count === 0 ? 0 : 4)}%` }}
                    />
                    <div className="relative flex w-full items-center justify-between px-3 z-10">
                      <span className="text-sm font-medium">{s.label}</span>
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg tabular font-semibold">{s.count}</span>
                        {top > 0 && i > 0 && (
                          <span className="text-[11px] text-muted-foreground tabular">{fmtPct(pctOfTop)} del top</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-4 text-xs text-muted-foreground border-t border-border pt-3 space-y-1">
          <div>{footer}</div>
          {note && <div className="text-[11px]">{note}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

function LeadStatusBreakdown({ counts }: { counts: Record<string, number> }) {
  const total = LEAD_ORDER.reduce((sum, s) => sum + (counts[s] ?? 0), 0)
  if (total === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Distribución de leads por estado</CardTitle>
        <CardDescription>Todos los leads del período, incluidos los perdidos</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {LEAD_ORDER.map((s) => {
            const n = counts[s] ?? 0
            const pct = total > 0 ? (n / total) * 100 : 0
            return (
              <div key={s} className="rounded-md border border-border p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{LEAD_LABEL[s]}</div>
                <div className="text-2xl tabular font-semibold mt-1">{n}</div>
                <div className="text-[11px] text-muted-foreground tabular">{fmtPct(pct)} del total</div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function Kpi({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />{label}
        </div>
        <div className="text-2xl tabular font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function safePct(n: number, d: number): number { return d > 0 ? (n / d) * 100 : 0 }
function fmtPct(pct: number): string {
  if (!isFinite(pct)) return "—"
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}%`
}

// -----------------------------------------------------------------------------
// Vendor performance report
// -----------------------------------------------------------------------------

type VendorRow = {
  name: string
  leadsTotal: number
  leadsWon: number
  quotesTotal: number
  quotesAccepted: number
  sales: number
  billed: number
  paid: number
  cogs: number
  ticket: number
  winRate: number
  grossMargin: number
  grossMarginPct: number
}

function VendorReport() {
  const { range } = usePeriod()
  const { role } = useRole()
  const sellerScope = role.kind === "vendor" ? role.sellerName : null

  const leads    = useApi<Lead[]>("/api/leads").data       ?? []
  const quotes   = useApi<Quote[]>("/api/quotes").data     ?? []
  const sales    = useApi<Sale[]>("/api/sales").data       ?? []
  const products = useApi<Product[]>("/api/products").data ?? []

  const data = useMemo(() => {
    // Cost map by product_id → product.cost (USD/unit). Used as gross-margin
    // proxy when a sale's items reference a known product.
    const costById = new Map<string, number>()
    for (const p of products) costById.set(p.id, Number(p.cost) || 0)

    // Period filters
    const periodLeads  = leads.filter(l => inRange(l.created_at, range))
    const periodQuotes = quotes.filter(q => inRange(q.created_at, range))
    const periodSales  = sales.filter(s => inRange(s.created_at, range) && ACTIVE_SALE_STATUSES.has(s.status))

    // Discover the vendor universe: anyone who shows up as seller or assigned_seller
    // in the period, plus the special "(sin asignar)" bucket for orphan rows.
    const names = new Set<string>()
    for (const l of periodLeads)  if (l.assigned_seller) names.add(l.assigned_seller); else names.add("(sin asignar)")
    for (const q of periodQuotes) if (q.seller_name)     names.add(q.seller_name);     else names.add("(sin asignar)")
    for (const s of periodSales)  if (s.seller_name)     names.add(s.seller_name);     else names.add("(sin asignar)")

    const rows: VendorRow[] = []
    for (const name of names) {
      // Vendor-scoped vendor view should only render their own row
      if (sellerScope && name !== sellerScope) continue
      const isOrphan = name === "(sin asignar)"

      const vLeads = periodLeads.filter(l => (l.assigned_seller ?? "(sin asignar)") === name)
      const vQuotes = periodQuotes.filter(q => (q.seller_name ?? "(sin asignar)") === name)
      const vSales  = periodSales.filter(s => (s.seller_name ?? "(sin asignar)") === name)

      const quotesAccepted = vQuotes.filter(q => q.status === "Aceptado" || q.status === "ACCEPTED").length
      const billed = vSales.reduce((sum, s) => sum + (s.contract_total ?? 0), 0)
      const paid   = vSales.reduce((sum, s) => sum + (s.financial_position?.total_paid ?? 0), 0)
      const cogs = vSales.reduce((sum, s) => {
        let sCogs = 0
        for (const it of s.items ?? []) {
          const c = costById.get(it.product_id) ?? 0
          sCogs += c * (Number(it.quantity) || 0)
        }
        return sum + sCogs
      }, 0)
      const leadsWon = vLeads.filter(l => l.status === "Won").length

      rows.push({
        name,
        leadsTotal: vLeads.length,
        leadsWon,
        quotesTotal: vQuotes.length,
        quotesAccepted,
        sales: vSales.length,
        billed,
        paid,
        cogs,
        ticket: vSales.length > 0 ? billed / vSales.length : 0,
        winRate: safePct(quotesAccepted, vQuotes.length),
        grossMargin: billed - cogs,
        grossMarginPct: safePct(billed - cogs, billed),
      })
      void isOrphan
    }
    rows.sort((a, b) => b.billed - a.billed)

    const totals = rows.reduce(
      (t, r) => ({
        leadsTotal:    t.leadsTotal    + r.leadsTotal,
        quotesTotal:   t.quotesTotal   + r.quotesTotal,
        quotesAccepted:t.quotesAccepted+ r.quotesAccepted,
        sales:         t.sales         + r.sales,
        billed:        t.billed        + r.billed,
        cogs:          t.cogs          + r.cogs,
      }),
      { leadsTotal: 0, quotesTotal: 0, quotesAccepted: 0, sales: 0, billed: 0, cogs: 0 }
    )

    return { rows, totals, hasData: rows.length > 0 }
  }, [leads, quotes, sales, products, range, sellerScope])

  const maxBilled = Math.max(1, ...data.rows.map(r => r.billed))

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="text-xs text-muted-foreground">Período: {fmtRange(range)} {sellerScope ? `· Solo: ${sellerScope}` : "· Todos los vendedores"}</div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Users}        label="Vendedores activos" value={data.rows.length.toString()} />
        <Kpi icon={FileText}     label="Cotizaciones"      value={data.totals.quotesTotal.toString()} />
        <Kpi icon={CheckCircle2} label="Ventas"            value={data.totals.sales.toString()} />
        <Kpi icon={TrendingUp}   label="Facturado"         value={fmtMoney(data.totals.billed)} />
      </div>

      {!data.hasData ? (
        <Card><CardContent className="text-sm text-muted-foreground py-10 text-center">Sin actividad de vendedores en este período.</CardContent></Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Vendedor</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Cotiz.</TableHead>
                <TableHead className="text-right">Win %</TableHead>
                <TableHead className="text-right">Ventas</TableHead>
                <TableHead className="text-right">Facturado</TableHead>
                <TableHead className="text-right">Ticket prom.</TableHead>
                <TableHead className="text-right">Margen bruto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r, i) => (
                <TableRow key={r.name}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {i === 0 && data.rows.length > 1 && r.billed > 0 && <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{r.name}</div>
                        <div className="mt-1 h-1 w-32 rounded bg-muted overflow-hidden">
                          <div className="h-full bg-primary/40" style={{ width: `${(r.billed / maxBilled) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular">
                    <div className="text-sm">{r.leadsTotal}</div>
                    <div className="text-[10px] text-muted-foreground">{r.leadsWon} ganados</div>
                  </TableCell>
                  <TableCell className="text-right tabular">
                    <div className="text-sm">{r.quotesTotal}</div>
                    <div className="text-[10px] text-muted-foreground">{r.quotesAccepted} aceptadas</div>
                  </TableCell>
                  <TableCell className="text-right tabular">{r.quotesTotal > 0 ? fmtPct(r.winRate) : "—"}</TableCell>
                  <TableCell className="text-right tabular">{r.sales}</TableCell>
                  <TableCell className="text-right tabular font-medium">{fmtMoney(r.billed)}</TableCell>
                  <TableCell className="text-right tabular">{r.sales > 0 ? fmtMoney(r.ticket) : "—"}</TableCell>
                  <TableCell className="text-right tabular">
                    <div>{fmtMoney(r.grossMargin)}</div>
                    <div className="text-[10px] text-muted-foreground">{r.billed > 0 ? fmtPct(r.grossMarginPct) : "—"}</div>
                  </TableCell>
                </TableRow>
              ))}
              {data.rows.length > 1 && (
                <TableRow className="bg-muted/30 font-medium">
                  <TableCell className="text-xs uppercase tracking-wide text-muted-foreground">Total</TableCell>
                  <TableCell className="text-right tabular text-sm">{data.totals.leadsTotal}</TableCell>
                  <TableCell className="text-right tabular text-sm">{data.totals.quotesTotal}</TableCell>
                  <TableCell className="text-right tabular text-sm">{data.totals.quotesTotal > 0 ? fmtPct(safePct(data.totals.quotesAccepted, data.totals.quotesTotal)) : "—"}</TableCell>
                  <TableCell className="text-right tabular text-sm">{data.totals.sales}</TableCell>
                  <TableCell className="text-right tabular text-sm">{fmtMoney(data.totals.billed)}</TableCell>
                  <TableCell className="text-right tabular text-sm">{data.totals.sales > 0 ? fmtMoney(data.totals.billed / data.totals.sales) : "—"}</TableCell>
                  <TableCell className="text-right tabular text-sm">
                    <div>{fmtMoney(data.totals.billed - data.totals.cogs)}</div>
                    <div className="text-[10px] text-muted-foreground font-normal">{data.totals.billed > 0 ? fmtPct(safePct(data.totals.billed - data.totals.cogs, data.totals.billed)) : "—"}</div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <div className="text-[11px] text-muted-foreground">
        Margen bruto estimado: Facturado − (cost del catálogo × cantidad). Es una aproximación;
        no refleja descuentos puntuales ni costos logísticos. La atribución real por COGS por venta vendrá del módulo de gastos.
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Receivables aging report
// -----------------------------------------------------------------------------

const DEFAULT_DAYS_TO_PAY = 30
const AGING_BUCKETS = [
  { key: "current",   label: "Al día (0-30)",   min: -Infinity, max: 30 },
  { key: "b30",       label: "31-60 días",      min: 31,        max: 60 },
  { key: "b60",       label: "61-90 días",      min: 61,        max: 90 },
  { key: "overdue",   label: "+90 días",        min: 91,        max: Infinity },
] as const

type AgingRow = {
  sale: Sale
  expectedAt: Date
  daysPast: number
  bucket: typeof AGING_BUCKETS[number]["key"]
}

function AgingReport() {
  const { role } = useRole()
  const sellerScope = role.kind === "vendor" ? role.sellerName : null

  const sales = useApi<Sale[]>("/api/sales").data ?? []

  const data = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const rows: AgingRow[] = []
    for (const s of sales) {
      const due = s.financial_position?.balance_due ?? 0
      if (due <= 0) continue
      if (sellerScope && s.seller_name !== sellerScope) continue

      const expectedISO = (s as any).expected_payment_date
        ? new Date((s as any).expected_payment_date)
        : new Date(new Date(s.created_at).getTime() + DEFAULT_DAYS_TO_PAY * 86400000)
      if (isNaN(+expectedISO)) continue
      const daysPast = Math.floor((+now - +expectedISO) / 86400000)
      const bucket = AGING_BUCKETS.find(b => daysPast >= b.min && daysPast <= b.max)!.key
      rows.push({ sale: s, expectedAt: expectedISO, daysPast, bucket })
    }
    // Buckets
    const byBucket = AGING_BUCKETS.map(b => {
      const items = rows.filter(r => r.bucket === b.key)
      const amount = items.reduce((sum, r) => sum + (r.sale.financial_position?.balance_due ?? 0), 0)
      return { ...b, count: items.length, amount }
    })
    const totalDue = byBucket.reduce((sum, b) => sum + b.amount, 0)
    const overdueAmount = byBucket.filter(b => b.key !== "current").reduce((sum, b) => sum + b.amount, 0)
    // Detail rows — most overdue first
    rows.sort((a, b) => b.daysPast - a.daysPast)

    return {
      byBucket,
      totalDue,
      overdueAmount,
      overdueCount: rows.filter(r => r.daysPast > 30).length,
      rows,
      hasData: rows.length > 0,
    }
  }, [sales, sellerScope])

  const maxBucket = Math.max(1, ...data.byBucket.map(b => b.amount))

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="text-xs text-muted-foreground">Snapshot al día de hoy {sellerScope ? `· Solo: ${sellerScope}` : "· Todos los vendedores"} · el filtro de período no aplica para aging</div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Wallet}       label="Total por cobrar"  value={fmtMoney(data.totalDue)} />
        <Kpi icon={AlertCircle}  label="Vencido (+30 días)" value={fmtMoney(data.overdueAmount)} />
        <Kpi icon={Clock}        label="Facturas vencidas"  value={data.overdueCount.toString()} />
        <Kpi icon={CheckCircle2} label="Facturas abiertas"  value={data.rows.length.toString()} />
      </div>

      {!data.hasData ? (
        <Card><CardContent className="text-sm text-muted-foreground py-10 text-center">Sin cuentas por cobrar.</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Buckets de aging</CardTitle>
              <CardDescription>Pendiente agrupado por días desde la fecha esperada de pago</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {data.byBucket.map((b) => {
                  const isOverdue = b.key !== "current"
                  const pctOfTotal = data.totalDue > 0 ? (b.amount / data.totalDue) * 100 : 0
                  return (
                    <div key={b.key} className={`rounded-md border p-3 ${isOverdue && b.amount > 0 ? "border-destructive/40" : "border-border"}`}>
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{b.label}</div>
                        <div className="text-[10px] text-muted-foreground tabular">{b.count} fact.</div>
                      </div>
                      <div className={`text-2xl tabular font-semibold mt-1 ${isOverdue && b.amount > 0 ? "text-destructive" : ""}`}>{fmtMoney(b.amount)}</div>
                      <div className="mt-2 h-1.5 w-full rounded bg-muted overflow-hidden">
                        <div className={`h-full ${isOverdue && b.amount > 0 ? "bg-destructive/60" : "bg-primary/40"}`} style={{ width: `${(b.amount / maxBucket) * 100}%` }} />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1 tabular">{fmtPct(pctOfTotal)} del total</div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Venta</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Cobrado</TableHead>
                  <TableHead className="text-right">Pendiente</TableHead>
                  <TableHead className="text-right">Vence</TableHead>
                  <TableHead className="text-right">Días</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => {
                  const due = r.sale.financial_position?.balance_due ?? 0
                  const total = r.sale.contract_total ?? 0
                  const paid  = r.sale.financial_position?.total_paid ?? 0
                  const overdue = r.daysPast > 0
                  return (
                    <TableRow key={r.sale.id}>
                      <TableCell>
                        <Link to="/ventas" className="text-sm font-medium hover:underline">#{r.sale.quote_number ?? r.sale.id}</Link>
                        <div className="text-[10px] text-muted-foreground">{r.sale.created_at ? new Date(r.sale.created_at).toLocaleDateString("es-AR") : "—"}</div>
                      </TableCell>
                      <TableCell className="text-sm">{r.sale.client_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.sale.seller_name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular text-sm">{fmtMoney(total)}</TableCell>
                      <TableCell className="text-right tabular text-sm">{fmtMoney(paid)}</TableCell>
                      <TableCell className="text-right tabular text-sm font-medium">{fmtMoney(due)}</TableCell>
                      <TableCell className="text-right tabular text-xs text-muted-foreground">{r.expectedAt.toLocaleDateString("es-AR")}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={overdue ? "destructive" : "muted"} className="tabular text-[11px]">
                          {r.daysPast > 0 ? `+${r.daysPast}d` : r.daysPast === 0 ? "hoy" : `${r.daysPast}d`}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <div className="text-[11px] text-muted-foreground">
        Días vencidos = (hoy − fecha esperada de pago). Cuando una venta no tiene <code>expected_payment_date</code>, se asume 30 días desde la creación.
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Margin report
// -----------------------------------------------------------------------------

type CatRow = { category: string; revenue: number; cogs: number; margin: number; marginPct: number; units: number; sales: number }
type ProductRow = { productId: string; sku: string; name: string; category: string; units: number; revenue: number; cogs: number; margin: number; marginPct: number }

const TREND_CHART_CONFIG: ChartConfig = {
  marginPct: { label: "Margen %", color: "var(--chart-1)" },
}

function MarginReport() {
  const { range } = usePeriod()
  const { role } = useRole()
  const sellerScope = role.kind === "vendor" ? role.sellerName : null

  const sales    = useApi<Sale[]>("/api/sales").data       ?? []
  const products = useApi<Product[]>("/api/products").data ?? []

  const data = useMemo(() => {
    const productById = new Map<string, Product>()
    for (const p of products) productById.set(p.id, p)
    const costOf = (pid: string) => Number(productById.get(pid)?.cost ?? 0) || 0
    const catOf  = (pid: string, fallback?: string) => fallback || productById.get(pid)?.category || "Sin categoría"

    const isInScope = (s: Sale) => {
      if (!inRange(s.created_at, range)) return false
      if (sellerScope && s.seller_name !== sellerScope) return false
      return ACTIVE_SALE_STATUSES.has(s.status)
    }
    const periodSales = sales.filter(isInScope)

    // ---- Per-category and per-product aggregation in the selected period ----
    const catMap = new Map<string, CatRow>()
    const prodMap = new Map<string, ProductRow>()
    let totalRevenue = 0, totalCogs = 0

    for (const s of periodSales) {
      const seen = new Set<string>()  // for unique sales-count per category in this sale
      for (const it of s.items ?? []) {
        const qty = Number(it.quantity) || 0
        const lineRev = Number(it.total) || qty * (Number(it.unit_price) || 0)
        const lineCost = costOf(it.product_id) * qty
        totalRevenue += lineRev
        totalCogs    += lineCost

        const cat = catOf(it.product_id, it.category)
        let c = catMap.get(cat)
        if (!c) { c = { category: cat, revenue: 0, cogs: 0, margin: 0, marginPct: 0, units: 0, sales: 0 }; catMap.set(cat, c) }
        c.revenue += lineRev; c.cogs += lineCost; c.units += qty
        if (!seen.has(cat)) { c.sales += 1; seen.add(cat) }

        const prodKey = it.product_id || it.sku
        let p = prodMap.get(prodKey)
        if (!p) {
          const prod = productById.get(it.product_id)
          p = { productId: prodKey, sku: it.sku, name: prod?.name ?? it.description, category: cat, units: 0, revenue: 0, cogs: 0, margin: 0, marginPct: 0 }
          prodMap.set(prodKey, p)
        }
        p.units += qty; p.revenue += lineRev; p.cogs += lineCost
      }
    }

    const catRows = Array.from(catMap.values()).map(c => ({ ...c, margin: c.revenue - c.cogs, marginPct: safePct(c.revenue - c.cogs, c.revenue) }))
    catRows.sort((a, b) => b.revenue - a.revenue)
    const prodRows = Array.from(prodMap.values()).map(p => ({ ...p, margin: p.revenue - p.cogs, marginPct: safePct(p.revenue - p.cogs, p.revenue) }))
    prodRows.sort((a, b) => b.margin - a.margin)

    // ---- 6-month margin trend (independent of period selector — always last 6) ----
    const months = lastNMonths(new Date(), 6)
    const trend = months.map((m) => {
      const ms = sales.filter(s => {
        if (!ACTIVE_SALE_STATUSES.has(s.status)) return false
        if (sellerScope && s.seller_name !== sellerScope) return false
        const d = new Date(s.created_at); return !isNaN(+d) && d >= m.from && d <= m.to
      })
      let rev = 0, cogs = 0
      for (const s of ms) for (const it of (s.items ?? [])) {
        const qty = Number(it.quantity) || 0
        rev += Number(it.total) || qty * (Number(it.unit_price) || 0)
        cogs += costOf(it.product_id) * qty
      }
      return { ym: m.ym, label: m.from.toLocaleDateString("es-AR", { month: "short" }), revenue: rev, cogs, margin: rev - cogs, marginPct: safePct(rev - cogs, rev) }
    })

    return {
      catRows,
      prodRows,
      trend,
      totals: { revenue: totalRevenue, cogs: totalCogs, margin: totalRevenue - totalCogs, marginPct: safePct(totalRevenue - totalCogs, totalRevenue) },
      hasData: periodSales.length > 0,
    }
  }, [sales, products, range, sellerScope])

  const maxCatRev = Math.max(1, ...data.catRows.map(c => c.revenue))

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="text-xs text-muted-foreground">Período: {fmtRange(range)} {sellerScope ? `· Solo: ${sellerScope}` : "· Todos los vendedores"}</div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp}  label="Facturado"      value={fmtMoney(data.totals.revenue)} />
        <Kpi icon={Boxes}       label="COGS estimado"  value={fmtMoney(data.totals.cogs)} />
        <Kpi icon={CheckCircle2} label="Margen bruto"  value={fmtMoney(data.totals.margin)} />
        <Kpi icon={Percent}     label="Margen %"        value={data.totals.revenue > 0 ? fmtPct(data.totals.marginPct) : "—"} />
      </div>

      {!data.hasData ? (
        <Card><CardContent className="text-sm text-muted-foreground py-10 text-center">Sin ventas activas en este período.</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Margen por categoría</CardTitle>
              <CardDescription>Comparación de revenue vs COGS estimado, ordenado por revenue</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.catRows.map((c) => (
                  <div key={c.category} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{c.category}</div>
                        <div className="text-[11px] text-muted-foreground">{c.units} unidades · {c.sales} ventas</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm tabular font-semibold">{fmtMoney(c.margin)}</div>
                        <div className="text-[11px] text-muted-foreground tabular">{c.revenue > 0 ? fmtPct(c.marginPct) : "—"}</div>
                      </div>
                    </div>
                    <div className="mt-2 h-3 w-full rounded bg-muted overflow-hidden flex">
                      <div className="h-full bg-primary/30" style={{ width: `${(c.cogs / maxCatRev) * 100}%` }} title={`COGS: ${fmtMoney(c.cogs)}`} />
                      <div className="h-full bg-emerald-500/60" style={{ width: `${(c.margin / maxCatRev) * 100}%` }} title={`Margen: ${fmtMoney(c.margin)}`} />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-3">
                      <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-primary/30" />COGS {fmtMoney(c.cogs)}</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-emerald-500/60" />Margen {fmtMoney(c.margin)}</span>
                      <span className="ml-auto tabular">Revenue {fmtMoney(c.revenue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden py-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <div className="text-sm font-medium">Top productos por margen contribuido</div>
                <div className="text-[11px] text-muted-foreground">Ordenado por $ de margen aportado en el período</div>
              </div>
              <div className="text-[11px] text-muted-foreground">{Math.min(15, data.prodRows.length)} de {data.prodRows.length}</div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">COGS</TableHead>
                  <TableHead className="text-right">Margen $</TableHead>
                  <TableHead className="text-right">Margen %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.prodRows.slice(0, 15).map((p) => (
                  <TableRow key={p.productId}>
                    <TableCell>
                      <div className="text-sm font-medium truncate max-w-[280px]">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground">{p.sku}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.category}</TableCell>
                    <TableCell className="text-right tabular text-sm">{p.units}</TableCell>
                    <TableCell className="text-right tabular text-sm">{fmtMoney(p.revenue)}</TableCell>
                    <TableCell className="text-right tabular text-sm">{fmtMoney(p.cogs)}</TableCell>
                    <TableCell className="text-right tabular text-sm font-medium">{fmtMoney(p.margin)}</TableCell>
                    <TableCell className="text-right tabular text-sm">{p.revenue > 0 ? fmtPct(p.marginPct) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tendencia de margen %</CardTitle>
              <CardDescription>Últimos 6 meses (independiente del período seleccionado)</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={TREND_CHART_CONFIG} className="aspect-auto h-[220px] w-full">
                <AreaChart data={data.trend} margin={{ top: 10, right: 6, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="marginPctFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--chart-1)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={40} domain={[0, "auto"]} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" formatter={(v) => `${Number(v).toFixed(1)}%`} />} />
                  <Area type="monotone" dataKey="marginPct" stroke="var(--chart-1)" fill="url(#marginPctFill)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </>
      )}

      <div className="text-[11px] text-muted-foreground">
        COGS estimado a partir del costo del producto en el catálogo en el momento de la consulta.
        Aproximación; el COGS real por venta vendrá del módulo de gastos vinculados.
      </div>
    </div>
  )
}
