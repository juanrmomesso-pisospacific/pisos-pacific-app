import { useEffect, useMemo, useState } from "react"
import { FormSheet, FieldLabel, FieldHint } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import type { Category, Caja } from "@/lib/types"

type Fx = { compra: number; venta: number; promedio: number; source?: string; updated_at?: string }

const EXPENSE_TYPES = [
  "COGS", "Gastos de Instalaciones y Suministros", "Gastos Administrativos",
  "Gastos de Personal (HR y Mano de Obra)", "Marketing y Ventas",
  "Gastos de Flota/Vehículos", "Depreciación y Amortización",
  "Impuestos y Tasas", "Otros Gastos y Ajustes",
]
const inputSel = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"

export function CashflowForm({ open, onOpenChange, cajas }: { open: boolean; onOpenChange: (o: boolean) => void; cajas: Caja[] }) {
  const categories = useApi<Category[]>("/api/categories").data ?? []
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
    description: "",
    amount_usd: 0,
    amount_ars: 0,
    exchange_rate: 1425,
  })

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
  const catNames = [...catMap.keys()].sort()
  const subs = [...(catMap.get(v.category) ?? new Set())].sort()

  const create = useAction(api.create)

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
      client_id: null,
      supplier_id: null,
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

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Nuevo movimiento" onSubmit={submit} busy={create.busy} error={create.error}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Flujo</FieldLabel>
          <select value={v.flow} onChange={(e) => setV({ ...v, flow: e.target.value as "Egreso" | "Ingreso", category: "", subcategory: "" })} className={inputSel}>
            <option value="Egreso">Egreso</option>
            <option value="Ingreso">Ingreso</option>
          </select>
        </div>
        <div>
          <FieldLabel>Fecha</FieldLabel>
          <Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </div>
      </div>

      <div>
        <FieldLabel>Caja / Cuenta</FieldLabel>
        <select value={v.caja_id} onChange={(e) => setV({ ...v, caja_id: e.target.value })} className={inputSel}>
          <option value="">— Seleccionar —</option>
          {cajas.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Categoría</FieldLabel>
          <select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value, subcategory: "" })} className={inputSel}>
            <option value="">— Seleccionar —</option>
            {catNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>Subcategoría</FieldLabel>
          <select value={v.subcategory} onChange={(e) => setV({ ...v, subcategory: e.target.value })} className={inputSel}>
            <option value="">—</option>
            {subs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {v.flow === "Egreso" ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Tipo de gasto (P&amp;L)</FieldLabel>
            <select value={v.expense_type} onChange={(e) => setV({ ...v, expense_type: e.target.value })} className={inputSel}>
              {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Fijo / Variable</FieldLabel>
            <select value={v.fixed_variable} onChange={(e) => setV({ ...v, fixed_variable: e.target.value })} className={inputSel}>
              <option value="Fijo">Fijo</option>
              <option value="Variable">Variable</option>
              <option value="Mixto">Mixto</option>
            </select>
          </div>
        </div>
      ) : null}

      <div>
        <FieldLabel>{v.flow === "Ingreso" ? "Cliente / origen" : "Proveedor / receptor"}</FieldLabel>
        <Input value={v.counterparty} onChange={(e) => setV({ ...v, counterparty: e.target.value })} placeholder={v.flow === "Ingreso" ? "Cliente, PANELES, etc." : "Proveedor…"} />
      </div>
      <div>
        <FieldLabel>Descripción</FieldLabel>
        <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <FieldLabel>USD</FieldLabel>
          <Input type="number" min={0} step="0.01" value={v.amount_usd} onChange={(e) => setV({ ...v, amount_usd: Number(e.target.value) })} placeholder="auto" />
        </div>
        <div>
          <FieldLabel>ARS</FieldLabel>
          <Input type="number" min={0} step="0.01" value={v.amount_ars} onChange={(e) => setV({ ...v, amount_ars: Number(e.target.value) })} />
        </div>
        <div>
          <FieldLabel>TC</FieldLabel>
          <Input type="number" min={0} value={v.exchange_rate} onChange={(e) => { setTcTouched(true); setV({ ...v, exchange_rate: Number(e.target.value) }) }} />
        </div>
      </div>
      <FieldHint>
        Cargá el monto en USD, o en ARS con el TC para convertir automáticamente. Los reportes consolidan en USD.
        {fx ? ` · TC sugerido: Blue prom. $${fx.promedio} (compra $${fx.compra} / venta $${fx.venta})` : ""}
      </FieldHint>
    </FormSheet>
  )
}
