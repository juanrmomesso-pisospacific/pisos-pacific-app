import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Wallet, Landmark, Banknote } from "lucide-react"
import { useApi } from "@/lib/api"
import { DataState } from "@/components/ui/data-state"
import type { CajaBalance } from "@/lib/types"

type BalancesResponse = { balances: CajaBalance[]; unassigned_movements: number }

const usd = (n: number) => "US$ " + Math.round(n).toLocaleString("es-AR")
const ars = (n: number) => "$ " + Math.round(n).toLocaleString("es-AR")
const iconFor = (type: string) =>
  /banco/i.test(type) ? Landmark : /efectivo/i.test(type) ? Banknote : Wallet

export default function CajasPage() {
  const { data, loading, error, refetch } = useApi<BalancesResponse>("/api/cajas/balances")
  const balances = data?.balances ?? []

  return (
   <DataState loading={loading} error={error} hasData={balances.length > 0} onRetry={refetch}>
    <div className="px-4 lg:px-6 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {balances.map((b) => {
          const Icon = iconFor(b.type)
          return (
            <Card key={b.caja_id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{b.name}</span>
                </div>
                <Badge variant="outline" className="text-[10px]">{b.currency}</Badge>
              </div>
              {/* Saldo consolidado en USD (el negocio se maneja en USD). */}
              <div className={`text-2xl font-semibold tabular ${b.balance_usd >= 0 ? "text-foreground" : "text-rose-500"}`}>{usd(b.balance_usd)}</div>
              <div className="text-[11px] text-muted-foreground">
                {b.movements} movimientos · {b.type}
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Caja / Cuenta</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Moneda</TableHead>
              <TableHead className="text-right">Movimientos</TableHead>
              <TableHead className="text-right">Saldo USD</TableHead>
              <TableHead className="text-right">Saldo ARS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {balances.map((b) => (
              <TableRow key={b.caja_id}>
                <TableCell className="font-medium">{b.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{b.type}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{b.currency}</Badge></TableCell>
                <TableCell className="text-right tabular text-muted-foreground">{b.movements}</TableCell>
                <TableCell className={`text-right tabular ${b.balance_usd < 0 ? "text-rose-500" : ""}`}>{usd(b.balance_usd)}</TableCell>
                <TableCell className={`text-right tabular ${b.balance_ars < 0 ? "text-rose-500" : ""}`}>{ars(b.balance_ars)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {data?.unassigned_movements ? (
        <div className="text-xs text-amber-500">
          {data.unassigned_movements} movimiento(s) sin caja asignada — revisar en CashFlow → “A revisar”.
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Saldos derivados sumando los movimientos del CashFlow (Ingresos − Egresos), <b>consolidados en USD</b> (el negocio se maneja en USD). La columna ARS es referencia para las cuentas en pesos.
      </p>
    </div>
   </DataState>
  )
}
