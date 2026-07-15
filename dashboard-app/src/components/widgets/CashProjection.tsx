import { useMemo } from "react"
import { Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, Line, ComposedChart } from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useApi } from "@/lib/api"
import { fmtMoney, appLocale } from "@/lib/utils"
import type { Sale } from "@/lib/types"

type Expense = { id: string; payment_date?: string; date?: string; amount?: number }

const config: ChartConfig = {
  inflow:  { label: "Cobros esperados", color: "var(--chart-2)" },
  outflow: { label: "Pagos previstos",  color: "var(--destructive)" },
  net:     { label: "Acumulado",        color: "var(--chart-1)" },
}

// Default rule: a sale with balance_due > 0 expects payment ~30 days after created_at,
// unless expected_payment_date is explicitly set.
const DEFAULT_DAYS_TO_PAY = 30

function startOfWeek(d: Date): Date {
  const x = new Date(d); x.setHours(0,0,0,0)
  const dow = (x.getDay() + 6) % 7  // Mon=0..Sun=6
  x.setDate(x.getDate() - dow)
  return x
}

export function CashProjection() {
  const sales    = useApi<Sale[]>("/api/sales").data ?? []
  const expenses = useApi<Expense[]>("/api/expenses").data ?? []

  const { data, totals } = useMemo(() => {
    const now = new Date(); now.setHours(0,0,0,0)
    const weekStarts = Array.from({ length: 4 }, (_, i) => {
      const d = startOfWeek(now); d.setDate(d.getDate() + i * 7); return d
    })
    const buckets = weekStarts.map((from) => {
      const to = new Date(from); to.setDate(to.getDate() + 7)
      return { from, to, label: from.toLocaleDateString(appLocale(), { day: "numeric", month: "short" }), inflow: 0, outflow: 0 }
    })

    // Inflows: balance_due on sales, due ~30d after created (or explicit field)
    for (const s of sales) {
      const due = s.financial_position?.balance_due ?? 0
      if (due <= 0) continue
      const expected = (s as any).expected_payment_date
        ? new Date((s as any).expected_payment_date)
        : new Date(new Date(s.created_at).getTime() + DEFAULT_DAYS_TO_PAY * 86400000)
      if (isNaN(+expected)) continue
      const b = buckets.find(b => expected >= b.from && expected < b.to)
      if (b) b.inflow += due
    }

    // Outflows: scheduled expenses with payment_date in window
    for (const e of expenses) {
      const dStr = e.payment_date || e.date
      if (!dStr) continue
      const d = new Date(dStr); if (isNaN(+d)) continue
      const b = buckets.find(b => d >= b.from && d < b.to)
      if (b) b.outflow += Number(e.amount) || 0
    }

    // Build chart rows + running net
    let cum = 0
    const rows = buckets.map(b => {
      const inflow = Math.round(b.inflow)
      const outflow = Math.round(b.outflow)
      cum += inflow - outflow
      return { week: b.label, inflow, outflow: -outflow, net: cum }
    })

    const t = {
      inflow:  rows.reduce((s, r) => s + r.inflow, 0),
      outflow: rows.reduce((s, r) => s + Math.abs(r.outflow), 0),
      net: cum,
    }
    return { data: rows, totals: t }
  }, [sales, expenses])

  const hasData = totals.inflow > 0 || totals.outflow > 0

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Proyección de caja</CardTitle>
        <CardDescription>4 semanas: cobros esperados (saldos) vs pagos previstos (gastos programados)</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="text-sm text-muted-foreground py-6">Sin movimientos previstos en las próximas 4 semanas.</div>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[250px] w-full">
            <ComposedChart data={data} margin={{ top: 10, right: 6, left: -10, bottom: 0 }} stackOffset="sign">
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={50} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" formatter={(v) => fmtMoney(Math.abs(Number(v)))} />} />
              <Bar dataKey="inflow"  stackId="cash" fill="var(--chart-2)" radius={4} />
              <Bar dataKey="outflow" stackId="cash" fill="var(--destructive)" radius={4} fillOpacity={0.45} />
              <Line type="monotone" dataKey="net" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ChartContainer>
        )}
        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
          <Tile label="Cobros 4-sem" value={fmtMoney(totals.inflow)} />
          <Tile label="Pagos 4-sem" value={fmtMoney(totals.outflow)} />
          <Tile label="Neto" value={fmtMoney(totals.net)} highlight />
        </div>
      </CardContent>
    </Card>
  )
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tabular mt-0.5 ${highlight ? "font-medium" : ""}`}>{value}</div>
    </div>
  )
}
