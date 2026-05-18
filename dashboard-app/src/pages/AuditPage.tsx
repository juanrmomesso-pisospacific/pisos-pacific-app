import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { fmtInt } from "@/lib/utils"
import type { Product } from "@/lib/types"

type Movement = {
  ts: string
  type: "container_receive" | "quote_reserve" | "quote_release" | "sale_deduct" | "sale_cancel_release" | string
  ref: string
  product_id: string
  sku: string
  qty: number
}

const TYPE_LABEL: Record<string, string> = {
  container_receive: "Container recibido",
  quote_reserve: "Cotización · reserva",
  quote_release: "Cotización · libera",
  sale_deduct: "Venta · descuenta",
  sale_cancel_release: "Venta cancelada · libera",
}

const TYPES = ["Todos", "container_receive", "quote_reserve", "quote_release", "sale_deduct", "sale_cancel_release"] as const

export default function AuditPage() {
  const movs = useApi<Movement[]>("/api/stock_movements").data ?? []
  const products = useApi<Product[]>("/api/products").data ?? []
  const [filter, setFilter] = useState<(typeof TYPES)[number]>("Todos")
  const [q, setQ] = useState("")

  const productNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of products) { m.set(p.id, p.name); m.set(p.sku, p.name) }
    return m
  }, [products])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...movs]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .filter((m) => {
        if (filter !== "Todos" && m.type !== filter) return false
        if (!needle) return true
        const name = productNameById.get(m.product_id) ?? productNameById.get(m.sku) ?? ""
        return m.sku.toLowerCase().includes(needle) || name.toLowerCase().includes(needle) || m.ref.toLowerCase().includes(needle)
      })
  }, [movs, filter, q, productNameById])

  const totals = useMemo(() => {
    let inMov = 0, outMov = 0
    for (const m of rows) (m.qty >= 0 ? inMov += m.qty : outMov += m.qty)
    return { inMov, outMov, net: inMov + outMov }
  }, [rows])

  return (
    <div className="px-4 lg:px-6 space-y-4">
      <div className="text-xs text-muted-foreground -mb-2">
        {movs.length} movimientos · mostrando {rows.length} · entradas {fmtInt(totals.inMov)} m² · salidas {fmtInt(Math.abs(totals.outMov))} m² · neto {fmtInt(totals.net)} m²
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {TYPES.map((t) => (
            <Button key={t} size="sm" variant={t === filter ? "default" : "outline"} onClick={() => setFilter(t)} className="h-8 px-3 text-xs">
              {t === "Todos" ? "Todos" : TYPE_LABEL[t] ?? t}
            </Button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar SKU, producto o referencia…" className="pl-8 h-8" />
        </div>
      </div>
      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead>Referencia</TableHead>
              <TableHead className="text-right">m²</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-10">Sin movimientos registrados todavía.</TableCell>
              </TableRow>
            ) : rows.map((m, i) => {
              const name = productNameById.get(m.product_id) ?? productNameById.get(m.sku) ?? "—"
              const isIn = m.qty >= 0
              return (
                <TableRow key={i}>
                  <TableCell className="text-xs text-muted-foreground tabular">{new Date(m.ts).toLocaleString("es-AR")}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{TYPE_LABEL[m.type] ?? m.type}</Badge></TableCell>
                  <TableCell><div className="text-sm truncate max-w-[280px]">{name}</div><div className="text-xs text-muted-foreground tabular">{m.sku}</div></TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular">{m.ref}</TableCell>
                  <TableCell className={`text-right tabular font-medium ${isIn ? "text-foreground" : "text-destructive"}`}>{isIn ? "+" : ""}{fmtInt(m.qty)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
