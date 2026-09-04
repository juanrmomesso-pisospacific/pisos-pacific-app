import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { DataState } from "@/components/ui/data-state"
import { fmtMoney, fmtInt, appLocale } from "@/lib/utils"
import type { Sale } from "@/lib/types"

type Client = { id: string; name: string; reseller?: boolean; reseller_mode?: string }

const COM_LABEL: Record<string, string> = { pct: "%", per_m2: "$/m²", tiered_m2: "escala m²" }

export default function ComisionesPage() {
  const salesApi = useApi<Sale[]>("/api/sales")
  const sales = salesApi.data ?? []
  const clients = useApi<Client[]>("/api/clients").data ?? []
  const markPaid = useAction(api.commissionPaid)

  // Ventas con comisión (revendedor asignado + monto), excluyendo canceladas.
  const rows = useMemo(() => sales.filter(s =>
    s.reseller_id && (Number(s.commission_amount) || 0) > 0 && s.status !== "Cancelado"
  ), [sales])

  const groups = useMemo(() => {
    const m = new Map<string, { id: string; name: string; sales: Sale[]; generado: number; pagado: number }>()
    for (const s of rows) {
      const id = s.reseller_id!
      const name = clients.find(c => c.id === id)?.name || s.reseller_name || "—"
      const g = m.get(id) ?? { id, name, sales: [], generado: 0, pagado: 0 }
      const amt = Number(s.commission_amount) || 0
      g.sales.push(s)
      g.generado += amt
      if (s.commission_paid) g.pagado += amt
      m.set(id, g)
    }
    return [...m.values()].sort((a, b) => (b.generado - b.pagado) - (a.generado - a.pagado))
  }, [rows, clients])

  const totals = useMemo(() => groups.reduce((t, g) => ({ generado: t.generado + g.generado, pagado: t.pagado + g.pagado }), { generado: 0, pagado: 0 }), [groups])
  const pendiente = totals.generado - totals.pagado

  async function toggle(s: Sale) {
    const r = await markPaid.run(s.id, !s.commission_paid)
    if (r) refresh()
  }

  return (
    <DataState loading={salesApi.loading} error={salesApi.error} hasData={sales.length > 0} onRetry={salesApi.refetch}>
      <div className="px-4 lg:px-6 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Tile label="Comisión generada" value={fmtMoney(totals.generado)} />
          <Tile label="Pagado" value={fmtMoney(totals.pagado)} />
          <Tile label="Pendiente de pago" value={fmtMoney(pendiente)} accent={pendiente > 0.5} />
        </div>

        {groups.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            No hay comisiones registradas todavía. Asigná un revendedor por comisión al cotizar/vender y aparecerán acá.
          </CardContent></Card>
        ) : groups.map((g) => {
          const gPend = g.generado - g.pagado
          return (
            <Card key={g.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{g.name}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    Generado {fmtMoney(g.generado)} · Pagado {fmtMoney(g.pagado)} ·
                    <span className={gPend > 0.5 ? "text-amber-700 font-medium" : ""}> Pendiente {fmtMoney(gPend)}</span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Venta</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="text-right">m² piso</TableHead>
                      <TableHead className="text-right">Comisión</TableHead>
                      <TableHead className="text-right">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.sales.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="tabular"><Link to={`/ventas?sale=${s.id}`} className="text-primary hover:underline">#{s.quote_number}</Link></TableCell>
                        <TableCell className="truncate max-w-[180px]">{s.client_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.created_at ? new Date(s.created_at).toLocaleDateString(appLocale()) : "—"}</TableCell>
                        <TableCell className="text-right tabular">{fmtInt(s.commission_m2 || 0)}<span className="text-[10px] text-muted-foreground ml-1">{COM_LABEL[s.commission_type || ""] || ""}</span></TableCell>
                        <TableCell className="text-right"><CommissionCell sale={s} /></TableCell>
                        <TableCell className="text-right">
                          {s.commission_paid ? (
                            <Button size="sm" variant="ghost" className="h-7 text-emerald-700" onClick={() => toggle(s)} disabled={markPaid.busy}>
                              <Badge variant="muted" className="text-[10px] mr-1">Pagada</Badge>deshacer
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" className="h-7" onClick={() => toggle(s)} disabled={markPaid.busy}>Marcar pagada</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </DataState>
  )
}

// Comisión editable por venta (depende de la obra; 7% es el default sugerido). Click en el
// monto → editar; "auto" vuelve al cálculo del revendedor.
function CommissionCell({ sale }: { sale: Sale }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(sale.commission_amount ?? 0))
  const set = useAction(api.commissionSet)
  async function save(body: { amount?: number; auto?: boolean }) {
    const r = await set.run(sale.id, body)
    if (r) { setEditing(false); refresh() }
  }
  if (editing) {
    return (
      <div className="flex items-center gap-1 justify-end">
        <Input type="number" min={0} step="0.01" value={val} onChange={(e) => setVal(e.target.value)} className="h-7 w-24 text-right" autoFocus />
        <Button size="sm" className="h-7 px-2" onClick={() => save({ amount: Number(val) || 0 })} disabled={set.busy}>OK</Button>
        {sale.commission_override && <Button size="sm" variant="ghost" className="h-7 px-1.5 text-[11px]" title="Volver al 7% sugerido" onClick={() => save({ auto: true })} disabled={set.busy}>auto</Button>}
        <button type="button" className="text-[11px] text-muted-foreground" onClick={() => setEditing(false)}>✕</button>
      </div>
    )
  }
  return (
    <button type="button" className="tabular font-medium hover:underline decoration-dotted" title="Editar comisión (depende de la obra)" onClick={() => { setVal(String(sale.commission_amount ?? 0)); setEditing(true) }}>
      {fmtMoney(sale.commission_amount || 0)}
      {sale.commission_override && <span className="text-[9px] text-amber-600 ml-1 align-top">editada</span>}
    </button>
  )
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular mt-1 ${accent ? "text-amber-700" : ""}`}>{value}</div>
    </div>
  )
}
