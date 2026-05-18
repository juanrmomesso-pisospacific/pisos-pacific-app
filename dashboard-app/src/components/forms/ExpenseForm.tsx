import { useMemo, useState } from "react"
import { FormSheet, FieldLabel } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import type { Sale } from "@/lib/types"

type SettingsResp = {
  paymentMethods?: string[]
  expenseCategories?: Record<string, string[]>
}

export function ExpenseForm({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const settings = useApi<SettingsResp>("/api/settings").data
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const categories = Object.keys(settings?.expenseCategories ?? {})
  const methods = settings?.paymentMethods ?? []
  const [saleQuery, setSaleQuery] = useState("")
  const saleMatches = useMemo(() => {
    const needle = saleQuery.trim().toLowerCase()
    if (!needle || needle.length < 2) return []
    return sales.filter(s =>
      s.quote_number?.toLowerCase().includes(needle) ||
      s.client_name?.toLowerCase().includes(needle)
    ).slice(0, 6)
  }, [sales, saleQuery])

  const today = new Date().toISOString().slice(0, 10)
  const [v, setV] = useState({
    date: today, payment_date: today,
    category: categories[0] ?? "", subcategory: "",
    description: "", receiver: "",
    payment_method: methods[0] ?? "",
    fixed_variable: "Variable",
    amount: 0, amount_usd: 0, exchange_rate: 1395,
    sale_reference: "",
  })
  const create = useAction(api.create)
  const subs = settings?.expenseCategories?.[v.category] ?? []

  async function submit() {
    if (!v.description || v.amount <= 0) return
    const body = {
      ...v,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      amount_usd: v.amount_usd || +(v.amount / v.exchange_rate).toFixed(2),
    }
    const r = await create.run("expenses", body)
    if (r) { onOpenChange(false); refresh() }
  }

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Nuevo gasto" onSubmit={submit} busy={create.busy} error={create.error}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Fecha</FieldLabel>
          <Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </div>
        <div>
          <FieldLabel>Fecha de pago</FieldLabel>
          <Input type="date" value={v.payment_date} onChange={(e) => setV({ ...v, payment_date: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Categoría</FieldLabel>
          <select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value, subcategory: "" })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>Subcategoría</FieldLabel>
          <select value={v.subcategory} onChange={(e) => setV({ ...v, subcategory: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">—</option>
            {subs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div>
        <FieldLabel>Descripción</FieldLabel>
        <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </div>
      <div>
        <FieldLabel>Proveedor / receptor</FieldLabel>
        <Input value={v.receiver} onChange={(e) => setV({ ...v, receiver: e.target.value })} />
      </div>
      <div>
        <FieldLabel>Método de pago</FieldLabel>
        <select value={v.payment_method} onChange={(e) => setV({ ...v, payment_method: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
          {methods.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <FieldLabel>Monto (ARS)</FieldLabel>
          <Input type="number" min={0} step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: Number(e.target.value) })} />
        </div>
        <div>
          <FieldLabel>USD</FieldLabel>
          <Input type="number" min={0} step="0.01" value={v.amount_usd} onChange={(e) => setV({ ...v, amount_usd: Number(e.target.value) })} placeholder="auto" />
        </div>
        <div>
          <FieldLabel>TC</FieldLabel>
          <Input type="number" min={0} value={v.exchange_rate} onChange={(e) => setV({ ...v, exchange_rate: Number(e.target.value) })} />
        </div>
      </div>
      <div>
        <FieldLabel>Tipo</FieldLabel>
        <select value={v.fixed_variable} onChange={(e) => setV({ ...v, fixed_variable: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="Fijo">Fijo</option>
          <option value="Variable">Variable</option>
        </select>
      </div>
      <div>
        <FieldLabel>Asociar a venta (opcional)</FieldLabel>
        {v.sale_reference ? (
          <div className="flex items-center justify-between border border-border rounded-md px-3 py-2 bg-muted/30 text-sm">
            <span>Venta vinculada: <b>#{v.sale_reference}</b></span>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setV({ ...v, sale_reference: "" })}>Quitar</button>
          </div>
        ) : (
          <>
            <Input value={saleQuery} onChange={(e) => setSaleQuery(e.target.value)} placeholder="Buscar por nº de venta o cliente…" />
            {saleMatches.length > 0 && (
              <div className="border border-border rounded-md mt-1 divide-y divide-border max-h-48 overflow-y-auto">
                {saleMatches.map(s => (
                  <button key={s.id} type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 flex items-center justify-between"
                    onClick={() => { setV({ ...v, sale_reference: s.quote_number }); setSaleQuery("") }}>
                    <span>#{s.quote_number} · {s.client_name}</span>
                    <span className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString("es-AR")}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Atribuye este gasto a una venta específica para cálculo de margen real.</p>
          </>
        )}
      </div>
    </FormSheet>
  )
}
