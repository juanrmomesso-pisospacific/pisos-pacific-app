import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { QuickSaleActions } from "@/components/RowActions"
import { useApi } from "@/lib/api"
import { fmtMoney } from "@/lib/utils"
import type { Sale } from "@/lib/types"

const STATUS_VARIANT: Record<string, "outline" | "secondary" | "muted"> = {
  Confirmado: "outline",
  Programado: "outline",
  "En proceso": "outline",
  Finalizado: "muted",
}

function initials(s: string): string {
  return s.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("")
}

export function RecentOrders({ max = 10 }: { max?: number }) {
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const rows = useMemo(() => [...sales].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")).slice(0, max), [sales, max])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pedidos Recientes</CardTitle>
        <CardDescription>Últimos {max} ingresados</CardDescription>
        <CardAction>
          <a href="/ventas" className="text-xs text-primary hover:underline">Ver todos →</a>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-muted-foreground tabular">#{r.quote_number}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-muted text-[10px] flex items-center justify-center font-medium">{initials(r.client_name)}</span>
                    <span className="truncate max-w-[200px]">{r.client_name}</span>
                  </div>
                </TableCell>
                <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
                <TableCell className="text-right tabular">{fmtMoney(r.contract_total)}</TableCell>
                <TableCell className="text-right"><QuickSaleActions sale={r} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
