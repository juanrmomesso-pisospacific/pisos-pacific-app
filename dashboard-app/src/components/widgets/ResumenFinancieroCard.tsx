import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useApi } from "@/lib/api"
import { usePeriod } from "@/contexts/PeriodContext"
import { aggregate } from "@/data/financialKpis"
import { fmtMoney, fmtPct } from "@/lib/utils"
import type { Product, Sale } from "@/lib/types"

export function ResumenFinancieroCard() {
  const { range } = usePeriod()
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const products = useApi<Product[]>("/api/products").data ?? []

  const summary = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of products) { m.set(p.sku, p.cost ?? 0); m.set(p.id, p.cost ?? 0) }
    return aggregate(sales, range, m)
  }, [sales, products, range])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumen Financiero</CardTitle>
        <CardDescription>Resumen del período seleccionado</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border/60">
          {[
            ["Ingresos Brutos", fmtMoney(summary.revenue)],
            ["Costo de Mercadería (COGS)", "- " + fmtMoney(summary.cogs)],
            ["Margen Neto", fmtMoney(summary.margin)],
            ["Margen %", fmtPct(summary.marginPct)],
            ["Ticket Promedio", fmtMoney(summary.avgTicket)],
          ].map(([k, v]) => (
            <div key={k} className="py-2 flex items-baseline justify-between text-sm">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="tabular">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
