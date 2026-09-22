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
import { ClientForm } from "@/components/forms/ClientForm"
import { SearchPicker } from "@/components/SearchPicker"
import { UserPlus, Pencil } from "lucide-react"
import type { Sale } from "@/lib/types"
import type { ResellerFields } from "@/lib/reseller"

type Client = { id: string; name: string } & ResellerFields & Record<string, unknown>

// Resumen de la config de un revendedor (para la lista de gestión).
function resellerSummary(c: Client): string {
  if (c.reseller_mode === "comision") {
    const k = c.reseller_comision
    if (k?.type === "pct") return `Comisión ${k.pct ?? 0}%`
    if (k?.type === "per_m2") return `Comisión $${k.per_m2 ?? 0}/m²`
    if (k?.type === "tiered_m2") return "Comisión por escala (m²)"
    if (k?.type === "price_list") return `Comisión por lista (${Object.keys(k.price_list ?? {}).length} precios)`
    return "Comisión"
  }
  const r = c.reseller_reventa
  if (r?.mode === "lista") return `Mayorista · lista de precios (${Object.keys(r.price_list ?? {}).length})`
  return `Mayorista · ${r?.desc_acuerdo ?? 0}% + tramos por volumen`
}

const COM_LABEL: Record<string, string> = { pct: "%", per_m2: "$/m²", tiered_m2: "escala m²" }

export default function ComisionesPage() {
  const salesApi = useApi<Sale[]>("/api/sales")
  const sales = salesApi.data ?? []
  const clients = useApi<Client[]>("/api/clients").data ?? []
  const markPaid = useAction(api.commissionPaid)
  const [editClient, setEditClient] = useState<Client | null>(null)
  const [adding, setAdding] = useState(false)
  const resellers = useMemo(() => clients.filter(c => c.reseller).sort((a, b) => a.name.localeCompare(b.name)), [clients])

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
        {/* ---- Gestión de revendedores (dónde se carga la comisión / lista de precios) ---- */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Revendedores</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">Arquitectos con comisión y mayoristas con su lista de precios. La config vive en la ficha del cliente.</p>
            </div>
            <Button size="sm" onClick={() => setAdding(a => !a)}><UserPlus className="h-4 w-4" />Agregar revendedor</Button>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {adding && (
              <div className="rounded-md border border-dashed border-border p-2 bg-muted/20">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Elegí un cliente para marcarlo revendedor</div>
                <SearchPicker
                  items={clients.filter(c => !c.reseller).map(c => ({ id: c.id, label: c.name }))}
                  placeholder="Buscar cliente…"
                  onPick={(id) => { const c = clients.find(x => x.id === id); if (c) { setEditClient({ ...c, reseller: true } as Client); setAdding(false) } }}
                />
                <p className="text-[10px] text-muted-foreground mt-1">Se abre su ficha con "Es revendedor" activado — elegí comisión o mayorista y guardá.</p>
              </div>
            )}
            {resellers.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-2">Sin revendedores cargados. Agregá uno para configurar su comisión o lista de precios.</div>
            ) : (
              <div className="divide-y divide-border rounded-md border border-border">
                {resellers.map(c => (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="flex-1 truncate font-medium">{c.name}</span>
                    <Badge variant={c.reseller_mode === "comision" ? "muted" : "outline"} className="text-[10px]">{c.reseller_mode === "comision" ? "Comisión" : "Mayorista"}</Badge>
                    <span className="text-xs text-muted-foreground hidden sm:block max-w-[220px] truncate">{resellerSummary(c)}</span>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => setEditClient(c)}><Pencil className="h-3.5 w-3.5" />Editar</Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-3">
          <Tile label="Comisión generada" value={fmtMoney(totals.generado)} />
          <Tile label="Pagado" value={fmtMoney(totals.pagado)} />
          <Tile label="Pendiente de pago" value={fmtMoney(pendiente)} accent={pendiente > 0.5} />
        </div>
        <p className="text-[11px] text-muted-foreground">La comisión ya está descontada del margen en el P&L (se computa al vender). Al pagarla, marcala <b>Pagada</b> acá — <b>no la cargues como gasto en el CashFlow</b> (sería contarla dos veces); si la registrás como movimiento de caja, marcala <b>Fuera del P&L</b>.</p>

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
      {editClient && <ClientForm key={editClient.id} open editClient={editClient as never} onOpenChange={(o) => { if (!o) setEditClient(null) }} />}
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
