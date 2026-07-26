import { useState } from "react"
import { FormSheet, FieldLabel } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { api, useAction, refresh } from "@/lib/mutations"
import type { Product } from "@/lib/types"

const CATEGORIES = ["Pisos H2O", "Pisos de Madera", "Zócalo", "Zócalos", "Deck", "Servicio", "Extras"]
const CURRENCIES = ["USD", "ARS"]

type FormState = Partial<Product> & { name: string; sku: string }

// Alta de producto y también EDICIÓN (editProduct): nombre/categoría/costo/precio/moneda.
// En edición NO se toca el stock (eso va por conciliación/ajuste para que quede auditado).
export function ProductForm({ open, onOpenChange, initial, editProduct }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: Partial<Product>; editProduct?: Product }) {
  const isEdit = !!editProduct
  const [v, setV] = useState<FormState>(
    editProduct ? ({ ...editProduct } as FormState)
    : initial && initial.id ? (initial as FormState)
    : { name: "", sku: "", category: "Pisos H2O", price: 0, cost: 0, currency: "USD", stock: 0, margin: 0, active: true, reservedStock: 0 } as FormState
  )

  const create = useAction(api.create)
  const update = useAction(api.update)
  const action = isEdit ? update : create

  async function submit() {
    if (!v.name || !v.sku) return
    const price = Number(v.price) || 0
    const cost = Number(v.cost) || 0
    const margin = cost > 0 ? Math.round(((price - cost) / cost) * 100) : 0
    if (isEdit) {
      const body: Record<string, unknown> = {
        name: v.name, sku: v.sku, category: v.category, price, cost, currency: v.currency, margin,
        stockTrack: !!v.stockTrack,
        updatedAt: new Date().toISOString(),
      }
      // Stock: solo si cambió (el server registra el delta como ajuste manual en la auditoría).
      const newStock = Number(v.stock) || 0
      if (v.stockTrack && newStock !== (Number(editProduct!.stock) || 0)) body.stock = newStock
      const r = await update.run("products", editProduct!.id, body)
      if (r) { onOpenChange(false); refresh() }
      return
    }
    const body = {
      name: v.name, sku: v.sku, category: v.category, price, cost, currency: v.currency,
      stock: Number(v.stock) || 0, reservedStock: Number(v.reservedStock) || 0,
      active: true, margin,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    const r = await create.run("products", body)
    if (r) { onOpenChange(false); refresh() }
  }

  const cats = CATEGORIES.includes(v.category || "") ? CATEGORIES : [...CATEGORIES, v.category || ""]
  return (
    <FormSheet open={open} onOpenChange={onOpenChange}
      title={isEdit ? `Editar producto · ${editProduct!.sku}` : "Nuevo Ítem"}
      description={isEdit ? "Cambiar nombre, categoría, costo o precio (el stock se ajusta desde Conciliación)" : "Crear un nuevo producto en el inventario"}
      onSubmit={submit} busy={action.busy} error={action.error}>
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
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
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
        {!isEdit && (
          <div>
            <FieldLabel>Stock inicial (m²)</FieldLabel>
            <Input type="number" min={0} value={v.stock ?? 0} onChange={(e) => setV({ ...v, stock: Number(e.target.value) })} />
          </div>
        )}
      </div>
      {isEdit && (
        <div className="rounded-md border border-border p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!v.stockTrack} onChange={(e) => setV({ ...v, stockTrack: e.target.checked })} />
            Controlar stock de este producto
          </label>
          {v.stockTrack && (
            <div>
              <FieldLabel>Stock físico</FieldLabel>
              <Input type="number" min={0} step="0.1" value={v.stock ?? 0} onChange={(e) => setV({ ...v, stock: Number(e.target.value) })} />
              <p className="text-[11px] text-muted-foreground mt-1">El cambio queda registrado como ajuste manual en Movimientos (auditoría).</p>
            </div>
          )}
        </div>
      )}
    </FormSheet>
  )
}
