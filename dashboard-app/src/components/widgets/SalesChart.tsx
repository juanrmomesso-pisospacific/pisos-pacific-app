import { useMemo, useState } from "react"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useApi } from "@/lib/api"
import { usePeriod } from "@/contexts/PeriodContext"
import { lastNMonths } from "@/lib/period"
import { fmtMoney } from "@/lib/utils"
import type { Sale } from "@/lib/types"

const MONTH_LABELS = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"]

type Window = "6m" | "12m" | "ytd"

const config: ChartConfig = {
  total: { label: "Ingresos", color: "var(--chart-1)" },
}

export function SalesChart() {
  const { range } = usePeriod()
  const { data: sales } = useApi<Sale[]>("/api/sales")
  const [window, setWindow] = useState<Window>("6m")

  const data = useMemo(() => {
    const n = window === "6m" ? 6 : window === "12m" ? 12 : (range.to.getMonth() + 1)
    const months = lastNMonths(range.to, n)
    return months.map((m) => {
      const total = (sales ?? []).reduce((sum, s) => {
        if (s.status !== "Confirmado") return sum
        const d = new Date(s.created_at)
        if (d >= m.from && d <= m.to) return sum + (s.contract_total || 0)
        return sum
      }, 0)
      return { month: MONTH_LABELS[m.from.getMonth()], total: Math.round(total) }
    })
  }, [sales, range, window])

  const winLabel = window === "6m" ? "últimos 6 meses" : window === "12m" ? "últimos 12 meses" : "este año (YTD)"

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Rendimiento de Ventas</CardTitle>
        <CardDescription>Ventas Confirmadas · {winLabel}</CardDescription>
        <CardAction>
          <Tabs value={window} onValueChange={(v) => setWindow(v as Window)}>
            <TabsList>
              <TabsTrigger value="6m">6m</TabsTrigger>
              <TabsTrigger value="12m">12m</TabsTrigger>
              <TabsTrigger value="ytd">YTD</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-[250px] w-full">
          <AreaChart data={data} margin={{ top: 10, right: 6, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={1.0} />
                <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={50} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" formatter={(v) => fmtMoney(Number(v))} />} />
            <Area type="monotone" dataKey="total" stroke="var(--chart-1)" strokeWidth={2} fill="url(#salesFill)" />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
