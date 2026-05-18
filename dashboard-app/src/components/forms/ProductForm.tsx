import { useState } from "react"
import { FormSheet, FieldLabel } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { api, useAction, refresh } from "@/lib/mutations"
import type { Product } from "@/lib/types"

const CATEGORIES = ["Pisos H2O", "Pisos de Madera", "Zócalo", "Deck", "Servicio", "Extras"]
const CURRENCIES = ["USD", "ARS"]

type FormState = Partial<Product> & { name: string; sku: string }

export function ProductForm({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: Partial<Product> }) {
  const [v, setV] = useState<FormState>(initial && initial.id ? (initial as FormState) : {
    name: "", sku: "", category: "Pisos H2O", price: 0, cost: 0, currency: "USD", stock: 0, margin: 0, active: true, reservedStock: 0,
  } as FormState)

  const create = useAction(api.create)

  async function submit() {
    if (!v.name || !v.sku) return
    const price = Number(v.price) || 0
    const cost = Number(v.cost) || 0
    const margin = cost > 0 ? Math.round(((price - cost) / cost) * 100) : 0
    const body = {
      name: v.name, sku: v.sku, category: v.category, price, cost, currency: v.currency,
      stock: Number(v.stock) || 0, reservedStock: Number(v.reservedStock) || 0,
      active: true, margin,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    const r = await create.run("products", body)
    if (r) { onOpenChange(false); refresh() }
  }

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Nuevo Ítem" description="Crear un nuevo producto en el inventario"
      onSubmit={submit} busy={create.busy} error={create.error}>
      <div>
        <FieldLabel>SKU</FieldLabel>
        <Input value={v.sku} onChange={(e) => setV({ ...v, sku: e.target.value })} placeholder="PROD-123" />
      </div>
      <div>
        <FieldLabel>Nombre</FieldLabel>
        <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="H2OHD - Roble Eslavonia 6,5mm x 18cm x 1,20m" />
      </div>
      <div>
        <FieldLabel>Categoría</FieldLabel>
        <select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Costo</FieldLabel>
          <Input type="number" min={0} step="0.01" value={v.cost ?? 0} onChange={(e) => setV({ ...v, cost: Number(e.target.value) })} />
        </div>
        <div>
          <FieldLabel>Precio</FieldLabel>
          <Input type="number" min={0} step="0.01" value={v.price ?? 0} onChange={(e) => setV({ ...v, price: Number(e.target.value) })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Moneda</FieldLabel>
          <select value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>Stock inicial (m²)</FieldLabel>
          <Input type="number" min={0} value={v.stock ?? 0} onChange={(e) => setV({ ...v, stock: Number(e.target.value) })} />
        </div>
      </div>
    </FormSheet>
  )
}
