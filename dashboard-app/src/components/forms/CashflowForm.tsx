import { useEffect, useMemo, useState } from "react"
import { FormSheet, FieldLabel, FieldHint } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { SearchPicker } from "@/components/SearchPicker"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import type { Category, Caja, Supplier } from "@/lib/types"
import { EXPENSE_TYPES, categoriesForType } from "@/lib/cashflow"

type Fx = { compra: number; venta: number; promedio: number; source?: string; updated_at?: string }
type ClientLite = { id: string; name: string; dni?: string; phones?: string[] }

const inputSel = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"

export function CashflowForm({ open, onOpenChange, cajas }: { open: boolean; onOpenChange: (o: boolean) => void; cajas: Caja[] }) {
  const categories = useApi<Category[]>("/api/categories").data ?? []
  const suppliers = useApi<Supplier[]>("/api/suppliers").data ?? []
  const clients = useApi<ClientLite[]>("/api/clients").data ?? []
  const [fx, setFx] = useState<Fx | null>(null)
  // Live Dólar Blue: fetch dolarapi directly (CORS-enabled); fall back to the backend.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch("https://dolarapi.com/v1/dolares/blue")
        const j = await r.json()
        const compra = Number(j.compra), venta = Number(j.venta)
        if (!cancelled) setFx({ compra, venta, promedio: Math.round((compra + venta) / 2 * 100) / 100, updated_at: j.fechaActualizacion })
      } catch {
        try {
          const r = await fetch("/api/fx/blue", { credentials: "include" })
          if (!cancelled) setFx(await r.json())
        } catch { /* keep manual default */ }
      }
    })()
    return () => { cancelled = true }
  }, [])
  const today = new Date().toISOString().slice(0, 10)
  const [tcTouched, setTcTouched] = useState(false)
  const [v, setV] = useState({
    flow: "Egreso" as "Egreso" | "Ingreso",
    date: today,
    caja_id: "",
    category: "",
    subcategory: "",
    expense_type: "Gastos de Instalaciones y Suministros",
    fixed_variable: "Variable",
    counterparty: "",
    supplier_id: "" as string,
    client_id: "" as string,
    description: "",
    amount_usd: 0,
    amount_ars: 0,
    exchange_rate: 1425,
  })
  const patch = (p: Partial<typeof v>) => setV((prev) => ({ ...prev, ...p }))

  // Default the exchange rate to the live Dólar Blue average (unless the user edited it).
  useEffect(() => {
    if (fx?.promedio && !tcTouched) setV((prev) => ({ ...prev, exchange_rate: fx.promedio }))
  }, [fx, tcTouched])

  // category -> subcategories for the selected flow
  const catMap = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const c of categories) {
      if (c.flow !== v.flow) continue
      const set = m.get(c.category) ?? new Set<string>()
      if (c.subcategory) set.add(c.subcategory)
      m.set(c.category, set)
    }
    return m
  }, [categories, v.flow])
  const allCatNames = [...catMap.keys()].sort()
  // Egreso: las categorías dependen del Tipo de Gasto elegido (cascada). Ingreso: todas.
  const catNames = v.flow === "Egreso" ? categoriesForType(v.expense_type, allCatNames) : allCatNames
  const subs = [...(catMap.get(v.category) ?? new Set())].sort()

  const create = useAction(api.create)
  const createCp = useAction(api.create)

  async function createSupplier(name: string) {
    const r = await createCp.run("suppliers", { name, type: "supplier", active: true, stock_code: null, category_default: null, notes: null })
    if (r) patch({ counterparty: (r as Supplier).name, supplier_id: (r as Supplier).id, client_id: "" })
  }
  async function createClient(name: string) {
    const r = await createCp.run("clients", { name, type: "client", dni: "", emails: [], phones: [], addresses: [], updated_at: new Date().toISOString() })
    if (r) patch({ counterparty: (r as ClientLite).name, client_id: (r as ClientLite).id, supplier_id: "" })
  }

  async function submit() {
    if (!v.caja_id || !v.description || (!v.amount_usd && !v.amount_ars)) return
    const caja = cajas.find((c) => c.id === v.caja_id)
    const usd = v.amount_usd || (v.amount_ars && v.exchange_rate ? +(v.amount_ars / v.exchange_rate).toFixed(2) : 0)
    const body = {
      id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: `${v.date}T00:00:00.000Z`,
      flow: v.flow,
      caja_id: v.caja_id,
      caja_name: caja?.name ?? null,
      category: v.category || null,
      subcategory: v.subcategory || null,
      counterparty: v.counterparty || null,
      counterparty_type: v.flow === "Ingreso" ? "client" : "supplier",
      client_id: v.client_id || null,
      supplier_id: v.supplier_id || null,
      description: v.description,
      sale_ref: null,
      currency: v.amount_usd && !v.amount_ars ? "USD" : "ARS",
      amount_ars: v.amount_ars || null,
      amount_usd: usd,
      exchange_rate: v.amount_ars && usd ? +(v.amount_ars / usd).toFixed(2) : null,
      fixed_variable: v.flow === "Egreso" ? v.fixed_variable : null,
      expense_type: v.flow === "Egreso" ? v.expense_type : null,
      transfer: false,
      needs_review: false,
      review_reason: null,
    }
    const r = await create.run("cashflow", body)
    if (r) { onOpenChange(false); refresh() }
  }

  const cpItems = (v.flow === "Egreso" ? suppliers : clients).map((x: any) => ({
    id: x.id, label: x.name, sub: x.dni || undefined, keywords: (x.phones || []).join(" "),
  }))
  const pickCp = (id: string) => {
    const found: any = (v.flow === "Egreso" ? suppliers : clients).find((x: any) => x.id === id)
    if (found) patch(v.flow === "Egreso"
      ? { counterparty: found.name, supplier_id: found.id, client_id: "" }
      : { counterparty: found.name, client_id: found.id, supplier_id: "" })
  }

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Nuevo movimiento" onSubmit={submit} busy={create.busy} error={create.error}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Flujo</FieldLabel>
          <select value={v.flow} onChange={(e) => patch({ flow: e.target.value as "Egreso" | "Ingreso", category: "", subcategory: "", counterparty: "", supplier_id: "", client_id: "" })} className={inputSel}>
            <option value="Egreso">Egreso</option>
            <option value="Ingreso">Ingreso</option>
          </select>
        </div>
        <div>
          <FieldLabel>Fecha</FieldLabel>
          <Input type="date" value={v.date} onChange={(e) => patch({ date: e.target.value })} />
        </div>
      </div>

      <div>
        <FieldLabel>Caja / Cuenta</FieldLabel>
        <select value={v.caja_id} onChange={(e) => patch({ caja_id: e.target.value })} className={inputSel}>
          <option value="">— Seleccionar —</option>
          {cajas.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
        </select>
      </div>

      {/* Egreso: Tipo de Gasto manda la cascada de categoría/subcategoría */}
      {v.flow === "Egreso" ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Tipo de gasto (P&amp;L)</FieldLabel>
            <select value={v.expense_type} onChange={(e) => patch({ expense_type: e.target.value, category: "", subcategory: "" })} className={inputSel}>
              {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Fijo / Variable</FieldLabel>
            <select value={v.fixed_variable} onChange={(e) => patch({ fixed_variable: e.target.value })} className={inputSel}>
              <option value="Fijo">Fijo</option>
              <option value="Variable">Variable</option>
              <option value="Mixto">Mixto</option>
            </select>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Categoría</FieldLabel>
          <select value={v.category} onChange={(e) => patch({ category: e.target.value, subcategory: "" })} className={inputSel}>
            <option value="">— Seleccionar —</option>
            {catNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>Subcategoría</FieldLabel>
          <select value={v.subcategory} onChange={(e) => patch({ subcategory: e.target.value })} className={inputSel} disabled={!v.category}>
            <option value="">—</option>
            {subs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div>
        <FieldLabel>{v.flow === "Ingreso" ? "Cliente / origen" : "Proveedor / receptor"}</FieldLabel>
        {v.counterparty ? (
          <div className="flex items-center justify-between border border-border rounded-md px-3 h-9 text-sm bg-muted/30">
            <span className="truncate">{v.counterparty}</span>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground shrink-0" onClick={() => patch({ counterparty: "", supplier_id: "", client_id: "" })}>cambiar</button>
          </div>
        ) : (
          <SearchPicker
            items={cpItems}
            placeholder={v.flow === "Ingreso" ? "Buscar cliente…" : "Buscar proveedor…"}
            onPick={pickCp}
            onCreate={v.flow === "Ingreso" ? createClient : createSupplier}
            createLabel={(t) => v.flow === "Ingreso" ? `+ Crear cliente "${t}"` : `+ Crear proveedor "${t}"`}
          />
        )}
      </div>
      <div>
        <FieldLabel>Descripción</FieldLabel>
        <Input value={v.description} onChange={(e) => patch({ description: e.target.value })} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <FieldLabel>USD</FieldLabel>
          <Input type="number" min={0} step="0.01" value={v.amount_usd} onChange={(e) => patch({ amount_usd: Number(e.target.value) })} placeholder="auto" />
        </div>
        <div>
          <FieldLabel>ARS</FieldLabel>
          <Input type="number" min={0} step="0.01" value={v.amount_ars} onChange={(e) => patch({ amount_ars: Number(e.target.value) })} />
        </div>
        <div>
          <FieldLabel>TC</FieldLabel>
          <Input type="number" min={0} value={v.exchange_rate} onChange={(e) => { setTcTouched(true); patch({ exchange_rate: Number(e.target.value) }) }} />
        </div>
      </div>
      <FieldHint>
        Cargá el monto en USD, o en ARS con el TC para convertir automáticamente. Los reportes consolidan en USD.
        {fx ? ` · TC sugerido: Blue prom. $${fx.promedio} (compra $${fx.compra} / venta $${fx.venta})` : ""}
      </FieldHint>
    </FormSheet>
  )
}
