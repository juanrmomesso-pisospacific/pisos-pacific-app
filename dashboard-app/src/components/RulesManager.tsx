import { useState } from "react"
import { Trash2, Plus } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { EXPENSE_TYPES } from "@/lib/cashflow"

type Rule = {
  id: string; match?: string[]; cuit?: string | null; counterparty?: string | null
  category?: string | null; expense_type?: string | null; personal?: boolean; source?: string
}
const inputSel = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"

// Reglas de clasificación de movimientos (proveedor/categoría/tipo por nombre o CUIT).
// Se aplican al importar extractos/MP y se aprenden solas al clasificar un movimiento.
export function RulesManager() {
  const rules = useApi<Rule[]>("/api/cp_rules").data ?? []
  const del = useAction(api.remove)
  const create = useAction(api.create)
  const [adding, setAdding] = useState(false)
  const [n, setN] = useState({ match: "", counterparty: "", category: "", expense_type: "Gastos de Instalaciones y Suministros" })

  async function add() {
    if (!n.match.trim() || !n.counterparty.trim()) return
    await create.run("cp_rules", {
      match: [n.match.trim()], cuit: null, counterparty: n.counterparty.trim(),
      category: n.category.trim() || null, expense_type: n.expense_type || null, personal: false, source: "manual",
    })
    setN({ match: "", counterparty: "", category: "", expense_type: "Gastos de Instalaciones y Suministros" })
    setAdding(false); refresh()
  }
  async function remove(id: string) { await del.run("cp_rules", id); refresh() }

  const sorted = [...rules].sort((a, b) => (a.counterparty || "").localeCompare(b.counterparty || ""))

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Reglas de clasificación</CardTitle>
          <CardDescription>Nombre o CUIT → proveedor + categoría + tipo de gasto. Se aplican al importar y se aprenden solas al clasificar un movimiento.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}><Plus className="h-4 w-4" />Agregar</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end rounded-md border border-border p-3 bg-muted/20">
            <div className="sm:col-span-1"><label className="text-xs">Si el nombre contiene</label><Input value={n.match} onChange={(e) => setN({ ...n, match: e.target.value })} placeholder="ej: matias trejo" /></div>
            <div className="sm:col-span-1"><label className="text-xs">Proveedor</label><Input value={n.counterparty} onChange={(e) => setN({ ...n, counterparty: e.target.value })} placeholder="Matias Flete" /></div>
            <div className="sm:col-span-1"><label className="text-xs">Categoría</label><Input value={n.category} onChange={(e) => setN({ ...n, category: e.target.value })} placeholder="Logística" /></div>
            <div className="sm:col-span-1"><label className="text-xs">Tipo de gasto</label>
              <select value={n.expense_type} onChange={(e) => setN({ ...n, expense_type: e.target.value })} className={inputSel}>
                {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <Button size="sm" onClick={add} disabled={create.busy}>Guardar regla</Button>
          </div>
        )}
        <div className="text-xs text-muted-foreground">{sorted.length} reglas</div>
        <div className="max-h-80 overflow-y-auto divide-y divide-border rounded-md border border-border">
          {sorted.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{r.counterparty || "—"} {r.personal && <Badge variant="outline" className="text-[10px]">personal</Badge>}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {(r.match || []).join(", ") || r.cuit || "—"} · {r.category || "—"} · {r.expense_type || "—"}
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">{r.source === "learned" ? "aprendida" : r.source === "manual" ? "manual" : "base"}</Badge>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
