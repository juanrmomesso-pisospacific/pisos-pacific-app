import { useMemo, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { FormSheet, FieldLabel } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { fmtMoney } from "@/lib/utils"
import type { Product } from "@/lib/types"
import { useConfig } from "@/contexts/ConfigContext"

type Client = { id: string; name: string; dni: string; phones?: string[]; emails?: string[]; addresses?: string[] }
type LineItem = { product_id: string; sku: string; description: string; quantity: number; unit_price: number; category: string; cost?: number }

export function SaleForm({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const clients = useApi<Client[]>("/api/clients").data ?? []
  const products = useApi<Product[]>("/api/products").data ?? []

  const [clientId, setClientId] = useState<string>("")
  const [title, setTitle] = useState<string>("")
  const [items, setItems] = useState<LineItem[]>([])
  const [hasIva, setHasIva] = useState<boolean>(false)
  const [reserve, setReserve] = useState<boolean>(true)
  const create = useAction(api.create)

  const { tax } = useConfig()   // impuesto por config de la operación
  const client = clients.find(c => c.id === clientId)
  const subtotal = useMemo(() => items.reduce((s, i) => s + (i.quantity * i.unit_price), 0), [items])
  const iva = hasIva ? subtotal * tax.rate : 0
  const total = subtotal + iva

  function addItem() { setItems([...items, { product_id: "", sku: "", description: "", quantity: 1, unit_price: 0, category: "" }]) }
  function updateItem(idx: number, patch: Partial<LineItem>) { setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it)) }
  function removeItem(idx: number) { setItems(items.filter((_, i) => i !== idx)) }
  function pickProduct(idx: number, productId: string) {
    const p = products.find(x => x.id === productId); if (!p) return
    updateItem(idx, { product_id: p.id, sku: p.sku, description: p.name, unit_price: p.price, cost: Number(p.cost) || 0, category: p.category })
  }

  async function submit() {
    if (!client || items.length === 0) return
    const quote_number = `A${Math.floor(Math.random() * 9000 + 1000)}`
    const body = {
      quote_number,
      title: title || client.name,
      description: items.length === 1 ? items[0].description : `${items[0]?.description ?? ""} + ${items.length - 1} más`,
      client_name: client.name,
      client_dni: client.dni,
      client_email: client.emails?.[0] ?? "",
      client_phone: client.phones?.[0] ?? "",
      client_address: client.addresses?.[0] ?? "",
      contract_total: total,
      items: items.map(it => ({ ...it, total: it.quantity * it.unit_price, image: "" })),
      status: "Confirmado",
      created_at: new Date().toISOString(),
      has_iva: hasIva,
      financial_position: { total_invoiced: 0, total_paid: 0, balance_due: total },
      stock_reserved: reserve,
      stock_deducted: false,
    }
    const r = await create.run("sales", body)
    if (r) { onOpenChange(false); refresh() }
  }

  const canSubmit = !!client && items.length > 0 && items.every(i => i.product_id && i.quantity > 0)

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Agregar venta" description="Crear una venta directamente (sin cotización)"
      onSubmit={submit} busy={create.busy} error={create.error || (!canSubmit ? "Cliente y al menos un item son requeridos" : "")}
      submitLabel={canSubmit ? "Crear venta" : "Completá los campos"}>
      <div>
        <FieldLabel>Cliente</FieldLabel>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="">— Elegí —</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <FieldLabel>Título / referencia</FieldLabel>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Obra Pilar" />
      </div>
      <div className="pt-2">
        <div className="flex items-center justify-between mb-2">
          <FieldLabel>Items</FieldLabel>
          <Button type="button" size="sm" variant="outline" onClick={addItem}><Plus className="h-3.5 w-3.5" />Agregar</Button>
        </div>
        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground italic border border-dashed border-border rounded-md p-3 text-center">Sin items todavía</div>
        ) : (
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <select value={it.product_id} onChange={(e) => pickProduct(idx, e.target.value)} className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-xs">
                    <option value="">— Elegí producto —</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                  </select>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeItem(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-0.5">Cantidad</div>
                    <Input type="number" min={0} step="0.1" value={it.quantity === 0 ? "" : it.quantity} placeholder="0" onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 0 })} className="h-8" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-0.5">Precio</div>
                    <Input type="number" min={0} step="0.01" value={it.unit_price === 0 ? "" : it.unit_price} placeholder="0" onChange={(e) => updateItem(idx, { unit_price: Number(e.target.value) || 0 })} className="h-8" />
                  </div>
                  <div className="text-right text-xs tabular pt-2"><span className="text-muted-foreground">Total: </span>{fmtMoney(it.quantity * it.unit_price)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm pt-2">
        <input type="checkbox" checked={hasIva} onChange={(e) => setHasIva(e.target.checked)} />Incluye {tax.label}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={reserve} onChange={(e) => setReserve(e.target.checked)} />Reservar stock al crear
      </label>
      <div className="bg-muted/50 rounded-md p-3 text-sm flex justify-between font-medium">
        <span>Total</span><span className="tabular">{fmtMoney(total)}</span>
      </div>
    </FormSheet>
  )
}
