import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Wallet, Landmark, Banknote, Scale } from "lucide-react"
import { useApi } from "@/lib/api"
import { DataState } from "@/components/ui/data-state"
import { api, refresh } from "@/lib/mutations"
import { useConfirm } from "@/components/ui/confirm"
import { cn } from "@/lib/utils"
import type { CajaBalance } from "@/lib/types"

type BalancesResponse = { balances: CajaBalance[]; unassigned_movements: number }
type Recon = { caja_id: string; ts: string; real: number; currency: string; real_usd: number; sys_usd: number; adj_usd: number; note: string | null }

const usd = (n: number) => "US$ " + Math.round(n).toLocaleString("es-AR")
const iconFor = (type: string) =>
  /banco/i.test(type) ? Landmark : /efectivo/i.test(type) ? Banknote : Wallet
const fmtDate = (ts: string) => { const d = ts.slice(0, 10).split("-"); return `${d[2]}/${d[1]}/${d[0]}` }

export default function CajasPage() {
  const { data, loading, error, refetch } = useApi<BalancesResponse>("/api/cajas/balances")
  const balances = data?.balances ?? []
  const recons = useApi<{ reconciliations: Recon[] }>("/api/cajas/reconciliations").data?.reconciliations ?? []
  const confirm = useConfirm()
  const [real, setReal] = useState<Record<string, string>>({})
  const [cur, setCur] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  // última conciliación por caja
  const lastByCaja: Record<string, Recon> = {}
  for (const r of recons) if (!lastByCaja[r.caja_id]) lastByCaja[r.caja_id] = r

  async function conciliar(b: CajaBalance) {
    const r = Number(String(real[b.caja_id] ?? "").replace(/\./g, "").replace(",", "."))
    if (!isFinite(r) || !real[b.caja_id]) return
    const currency = cur[b.caja_id] ?? b.currency
    setBusy(b.caja_id)
    try {
      const dry: any = await api.cajaReconcile(b.caja_id, { real: r, currency })
      const adj = dry.adj_usd as number
      // La diferencia ANTES de anclar es la señal de lo que falta registrar. Diagnóstico:
      // diff_ars = diferencia exacta en pesos (sin ruido cambiario, si hay ancla ARS previa);
      // missing_days = días hábiles sin movimientos (falta importar el extracto de esos días).
      const partes: string[] = []
      if (Math.abs(adj) < 0.01) partes.push(`El saldo del sistema (${usd(dry.sys_usd)}) ya coincide con el real. ✔ Todo registrado.`)
      else {
        partes.push(`Sistema ${usd(dry.sys_usd)} → real ${usd(dry.real_usd)} · diferencia ${adj > 0 ? "+" : ""}${usd(adj)}.`)
        if (dry.diff_ars != null) partes.push(`En PESOS (sin efecto del tipo de cambio): faltan ${dry.diff_ars > 0 ? "registrar ingresos" : "registrar egresos"} por $ ${Math.abs(dry.diff_ars).toLocaleString("es-AR")}.`)
        partes.push(`Si la diferencia no es chica, ANTES de conciliar buscá qué falta: subí los extractos pendientes o cargá el efectivo sin registrar — la diferencia queda guardada en el historial.`)
      }
      if (dry.missing_days?.length) partes.push(`⚠️ Días hábiles SIN movimientos en esta caja: ${dry.missing_days.map((d: string) => d.slice(5).split("-").reverse().join("/")).join(", ")} — probablemente falte importar el extracto de esos días.`)
      partes.push(`Conciliar fija el ancla de hoy: el saldo pasa a ser el valor real + lo que entre después. No afecta el resultado (P&L).`)
      const ok = await confirm({
        title: `Conciliar ${b.name}`,
        description: partes.join("\n\n"),
        confirmLabel: "Conciliar",
      })
      if (!ok) { setBusy(null); return }
      await api.cajaReconcile(b.caja_id, { real: r, currency, commit: true })
      refresh()
    } finally { setBusy(null) }
  }

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
              <div className={`text-2xl font-semibold tabular ${b.balance_usd >= 0 ? "text-foreground" : "text-rose-500"}`}>{usd(b.balance_usd)}</div>
              <div className="text-[11px] text-muted-foreground">
                {b.movements} movimientos · {b.type}
                {(b as any).anchor_date ? <> · anclada al {(b as any).anchor_date.split("-").reverse().join("/")}</> : null}
              </div>
            </Card>
          )
        })}
      </div>

      {/* ---- Conciliación: saldo sistema vs real, con ajuste en un click ---- */}
      <Card className="overflow-hidden py-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Scale className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Conciliación de cajas</span>
          <span className="ml-auto text-[11px] text-muted-foreground">ingresá el saldo real (del banco/arqueo) y conciliá</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Caja</TableHead>
                <TableHead className="text-right">Saldo sistema (USD)</TableHead>
                <TableHead>Última conciliación</TableHead>
                <TableHead className="text-right">Saldo real</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((b) => {
                const last = lastByCaja[b.caja_id]
                return (
                  <TableRow key={b.caja_id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className={cn("text-right tabular", b.balance_usd < 0 && "text-rose-500")}>{usd(b.balance_usd)}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {last ? <>{fmtDate(last.ts)} · real {last.currency} {Math.round(last.real).toLocaleString("es-AR")}</> : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Input
                          value={real[b.caja_id] ?? ""}
                          onChange={(e) => setReal((s) => ({ ...s, [b.caja_id]: e.target.value }))}
                          placeholder="saldo real"
                          className="h-8 w-32 text-right tabular"
                          inputMode="decimal"
                        />
                        <select
                          value={cur[b.caja_id] ?? b.currency}
                          onChange={(e) => setCur((s) => ({ ...s, [b.caja_id]: e.target.value }))}
                          className="h-8 rounded-md border border-input bg-transparent px-1 text-xs"
                        >
                          <option value="ARS">ARS</option>
                          <option value="USD">USD</option>
                        </select>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" className="h-8" disabled={busy === b.caja_id || !real[b.caja_id]} onClick={() => conciliar(b)}>
                        {busy === b.caja_id ? "…" : "Conciliar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="overflow-hidden py-0">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Caja / Cuenta</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Moneda</TableHead>
              <TableHead className="text-right">Movimientos</TableHead>
              <TableHead className="text-right">Saldo USD</TableHead>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </Card>

      {data?.unassigned_movements ? (
        <div className="text-xs text-amber-500">
          {data.unassigned_movements} movimiento(s) sin caja asignada — revisar en CashFlow → “A revisar”.
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Saldos derivados sumando los movimientos del CashFlow (Ingresos − Egresos), <b>consolidados en USD</b>. Las cuentas en pesos se convierten al dólar blue del momento. <b>No se muestra un "saldo ARS"</b>: las cajas no tienen saldo inicial cargado, así que ese número acumulaba millones en negativo sin significar nada (el saldo confiable es el USD conciliado). La <b>conciliación</b> registra la diferencia como transferencia: corrige el saldo sin afectar el resultado.
      </p>
    </div>
   </DataState>
  )
}
