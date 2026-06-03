import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import type { Supplier, CashflowMovement } from "@/lib/types"

const usd = (n: number) => (n ? "US$ " + Math.round(n).toLocaleString("es-AR") : "—")

export default function ProveedoresPage() {
  const suppliers = useApi<Supplier[]>("/api/suppliers").data ?? []
  const movements = useApi<CashflowMovement[]>("/api/cashflow").data ?? []
  const [q, setQ] = useState("")

  const spendBySupplier = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>()
    for (const x of movements) {
      if (x.flow !== "Egreso" || !x.supplier_id) continue
      const cur = m.get(x.supplier_id) ?? { total: 0, count: 0 }
      cur.total += x.amount_usd || 0
      cur.count += 1
      m.set(x.supplier_id, cur)
    }
    return m
  }, [movements])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return suppliers
      .filter((s) => !needle || s.name?.toLowerCase().includes(needle) || (s.type ?? "").toLowerCase().includes(needle))
      .sort((a, b) => (spendBySupplier.get(b.id)?.total ?? 0) - (spendBySupplier.get(a.id)?.total ?? 0))
  }, [suppliers, q, spendBySupplier])

  return (
    <div className="px-4 lg:px-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground">Mostrando {rows.length} de {suppliers.length} proveedores</div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o tipo…" className="pl-8 h-8" />
        </div>
      </div>
      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Proveedor</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Cód. stock</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right"># Pagos</TableHead>
              <TableHead className="text-right">Total pagado (USD)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => {
              const spend = spendBySupplier.get(s.id)
              return (
                <TableRow key={s.id}>
                  <TableCell><div className="font-medium">{s.name}</div>{s.notes ? <div className="text-[11px] text-muted-foreground truncate max-w-[280px]">{s.notes}</div> : null}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.type || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular">{s.stock_code || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{s.active ? "Activo" : "Inactivo"}</Badge></TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">{spend?.count ?? 0}</TableCell>
                  <TableCell className="text-right tabular">{usd(spend?.total ?? 0)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
