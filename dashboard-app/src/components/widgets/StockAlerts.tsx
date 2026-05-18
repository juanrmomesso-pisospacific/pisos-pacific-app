import { useMemo } from "react"
import { AlertCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card"
import { useApi } from "@/lib/api"
import { stockOutsWithDemand } from "@/data/operationalKpis"
import { fmtMoney, fmtInt } from "@/lib/utils"
import type { Product, Quote } from "@/lib/types"

export function StockAlerts({ windowDays = 30, max = 5 }: { windowDays?: number; max?: number }) {
  const products = useApi<Product[]>("/api/products").data ?? []
  const quotes = useApi<Quote[]>("/api/quotes").data ?? []
  const { list, count } = useMemo(() => stockOutsWithDemand(products, quotes, windowDays), [products, quotes, windowDays])
  const top = list.slice(0, max)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-rose-500" /> Alertas de Stock</CardTitle>
        <CardDescription>Productos en 0 con demanda activa, por riesgo</CardDescription>
        {count > max ? <CardAction><span className="text-[11px] text-muted-foreground">+{count - max} más</span></CardAction> : null}
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6">Sin quiebres con demanda activa.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {top.map(({ p, demandAtRisk }) => (
              <li key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">{p.sku} · reservado {fmtInt(p.reservedStock)}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm tabular font-medium">{fmtMoney(demandAtRisk)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">en riesgo</div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3"><a href="/inventario" className="text-xs text-primary hover:underline">Ver inventario completo →</a></div>
      </CardContent>
    </Card>
  )
}
