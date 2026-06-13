import { useEffect, useMemo, useState } from "react"
import { FormSheet, FieldLabel, FieldHint } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { SearchPicker } from "@/components/SearchPicker"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import type { Category, Caja, Supplier } from "@/lib/types"
import { EXPENSE_TYPES, categoriesForType } from "@/lib/cashflow"

type Fx = { compra: number; venta: number; promedio: number; updated_at?: string }

const CASH_CAJA = "CAJ-005" // Caja General = efectivo
const inputSel = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"

// Inferencia liviana del tipo de gasto a partir de la descripción (con override manual).
const INFER: [RegExp, string][] = [
  [/flete|acarreo|env[ií]o|cargo|log[ií]st|camion/i, "Gastos de Instalaciones y Suministros"],
  [/ferret|tornill|silicon|pegament|adhesiv|herramient|insumo|clavo|cinta|madera|z[oó]calo/i, "Gastos de Instalaciones y Suministros"],
  [/nafta|combustible|peaje|patente|seguro|service|goma|cubierta|estaci[oó]n|ypf|shell|axion/i, "Gastos de Flota/Vehículos"],
  [/sueldo|jornal|colocad|mano de obra|adelanto|gast[oó]n|hugo|ariel|fabi[aá]n|oso|maldo/i, "Gastos de Personal (HR y Mano de Obra)"],
  [/comida|almuerzo|caf[eé]|super|kiosco|merienda|agua/i, "Gastos de Personal (HR y Mano de Obra)"],
  [/arca|afip|impuesto|tasa|sellado|ingresos brutos/i, "Impuestos y Tasas"],
  [/alquiler|expensa|\bluz\b|\bgas\b|internet|tel[eé]fono/i, "Gastos Administrativos"],
  [/marketing|publicidad|cartel|folleto|imprenta/i, "Marketing y Ventas"],
]
function inferType(desc: string): string {
  for (const [re, t] of INFER) if (re.test(desc)) return t
  return "Gastos de Instalaciones y Suministros"
}

export function CashQuickForm({ open, onOpenChange, cajas }: { open: boolean; onOpenChange: (o: boolean) => void; cajas: Caja[] }) {
  const categories = useApi<Category[]>("/api/categories").data ?? []
  const suppliers = useApi<Supplier[]>("/api/suppliers").data ?? []
  const [fx, setFx] = useState<Fx | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch("https://dolarapi.com/v1/dolares/blue")
        const j = await r.json()
        const compra = Number(j.compra), venta = Number(j.venta)
        if (!cancelled) setFx({ compra, venta, promedio: Math.round((compra + venta) / 2 * 100) / 100, updated_at: j.fechaActualizacion })
      } catch {
        try { const r = await fetch("/api/fx/blue", { credentials: "include" }); if (!cancelled) setFx(await r.json()) } catch { /* default manual */ }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const [tcTouched, setTcTouched] = useState(false)
  const [typeTouched, setTypeTouched] = useState(false)
  const [v, setV] = useState({
    date: today, currency: "ARS" as "ARS" | "USD", amount: 0,
    description: "", category: "", subcategory: "", expense_type: "Gastos de Instalaciones y Suministros",
    counterparty: "", supplier_id: "", exchange_rate: 1425,
  })
  const patch = (p: Partial<typeof v>) => setV((prev) => ({ ...prev, ...p }))

  useEffect(() => { if (fx?.promedio && !tcTouched) setV((p) => ({ ...p, exchange_rate: fx.promedio })) }, [fx, tcTouched])

  // category -> subcategories (Egreso) + categorías filtradas por el tipo de gasto (cascada)
  const catMap = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const c of categories) {
      if (c.flow !== "Egreso") continue
      const set = m.get(c.category) ?? new Set<string>()
      if (c.subcategory) set.add(c.subcategory)
      m.set(c.category, set)
    }
    return m
  }, [categories])
  const catNames = categoriesForType(v.expense_type, [...catMap.keys()].sort())
  const subs = [...(catMap.get(v.category) ?? new Set())].sort()

  const onDescChange = (desc: string) => {
    if (typeTouched) { patch({ description: desc }); return }
    const t = inferType(desc)
    patch({ description: desc, expense_type: t, category: "", subcategory: "" })
  }

  const usdPreview = v.currency === "USD" ? v.amount : (v.amount && v.exchange_rate ? +(v.amount / v.exchange_rate).toFixed(2) : 0)
  const create = useAction(api.create)
  const createSup = useAction(api.create)

  async function createSupplier(name: string) {
    const r = await createSup.run("suppliers", { name, type: "supplier", active: true, stock_code: null, category_default: null, notes: null })
    if (r) patch({ counterparty: (r as Supplier).name, supplier_id: (r as Supplier).id })
  }

  async function submit() {
    if (!v.amount || !v.description) return
    const caja = cajas.find((c) => c.id === CASH_CAJA)
    const isUsd = v.currency === "USD"
    const body = {
      id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: `${v.date}T00:00:00.000Z`,
      flow: "Egreso",
      caja_id: CASH_CAJA,
      caja_name: caja?.name ?? "Caja General",
      category: v.category || null,
      subcategory: v.subcategory || null,
      counterparty: v.counterparty || null,
      counterparty_type: "supplier",
      client_id: null, supplier_id: v.supplier_id || null,
      description: v.description,
      sale_ref: null,
      currency: v.currency,
      amount_ars: isUsd ? null : v.amount,
      amount_usd: usdPreview,
      exchange_rate: isUsd ? null : v.exchange_rate,
      fixed_variable: "Variable",
      expense_type: v.expense_type,
      transfer: false,
      needs_review: false,
      review_reason: null,
      source: "efectivo-app",
    }
    const r = await create.run("cashflow", body)
    if (r) {
      onOpenChange(false); refresh()
      setV((p) => ({ ...p, amount: 0, description: "", category: "", subcategory: "", counterparty: "", supplier_id: "" }))
      setTypeTouched(false)
    }
  }

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Gasto en efectivo" onSubmit={submit} busy={create.busy} error={create.error}>
      <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Va directo a <b>Caja General (efectivo)</b> como egreso. Cargá monto y descripción; el tipo de gasto se completa solo (lo podés cambiar).
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <FieldLabel>Monto</FieldLabel>
          <Input type="number" min={0} step="0.01" value={v.amount || ""} autoFocus
            onChange={(e) => patch({ amount: Number(e.target.value) })} placeholder="0" />
        </div>
        <div>
          <FieldLabel>Moneda</FieldLabel>
          <select value={v.currency} onChange={(e) => patch({ currency: e.target.value as "ARS" | "USD" })} className={inputSel}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </div>
      </div>

      <div>
        <FieldLabel>Descripción</FieldLabel>
        <Input value={v.description} onChange={(e) => onDescChange(e.target.value)} placeholder="Ej: ferretería, nafta, flete Matías…" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Tipo de gasto (P&amp;L)</FieldLabel>
          <select value={v.expense_type} onChange={(e) => { setTypeTouched(true); patch({ expense_type: e.target.value, category: "", subcategory: "" }) }} className={inputSel}>
            {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>Categoría <span className="text-muted-foreground">(opcional)</span></FieldLabel>
          <select value={v.category} onChange={(e) => patch({ category: e.target.value, subcategory: "" })} className={inputSel}>
            <option value="">—</option>
            {catNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Subcategoría <span className="text-muted-foreground">(opcional)</span></FieldLabel>
          <select value={v.subcategory} onChange={(e) => patch({ subcategory: e.target.value })} className={inputSel} disabled={!v.category}>
            <option value="">—</option>
            {subs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>Proveedor <span className="text-muted-foreground">(opcional)</span></FieldLabel>
          {v.counterparty ? (
            <div className="flex items-center justify-between border border-border rounded-md px-3 h-9 text-sm bg-muted/30">
              <span className="truncate">{v.counterparty}</span>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground shrink-0" onClick={() => patch({ counterparty: "", supplier_id: "" })}>cambiar</button>
            </div>
          ) : (
            <SearchPicker
              items={suppliers.map((s) => ({ id: s.id, label: s.name }))}
              placeholder="Buscar proveedor…"
              onPick={(id) => { const s = suppliers.find((x) => x.id === id); if (s) patch({ counterparty: s.name, supplier_id: s.id }) }}
              onCreate={createSupplier}
              createLabel={(t) => `+ Crear proveedor "${t}"`}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Fecha</FieldLabel>
          <Input type="date" value={v.date} onChange={(e) => patch({ date: e.target.value })} />
        </div>
        {v.currency === "ARS" ? (
          <div>
            <FieldLabel>TC (Blue)</FieldLabel>
            <Input type="number" min={0} value={v.exchange_rate} onChange={(e) => { setTcTouched(true); patch({ exchange_rate: Number(e.target.value) }) }} />
          </div>
        ) : null}
      </div>

      <FieldHint>
        {v.currency === "ARS"
          ? <>Se consolida en USD: <b>US${usdPreview || 0}</b>{fx ? ` · Blue prom. $${fx.promedio}` : ""}.</>
          : <>Gasto en dólares (efectivo).</>}
      </FieldHint>
    </FormSheet>
  )
}
