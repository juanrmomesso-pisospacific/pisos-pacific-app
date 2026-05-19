import { useEffect, useState } from "react"
import { FormSheet, FieldLabel } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { type LeadStatus, STATUS_ORDER, STATUS_LABEL, SOURCES, type Lead } from "@/lib/leads"

type Settings = { sellers?: { name: string }[] }

function blankFromInitial(initial?: Partial<Lead>) {
  return {
    name: initial?.name ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    source: (initial?.source ?? "WhatsApp") as (typeof SOURCES)[number],
    interested_products: initial?.interested_products?.join(", ") ?? "",
    notes: initial?.notes ?? "",
    status: (initial?.status ?? "New") as LeadStatus,
    assigned_seller: initial?.assigned_seller ?? "",
    address: (initial as any)?.address ?? "",
  }
}

export function LeadForm({ open, onOpenChange, initial, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: Partial<Lead>; onCreated?: (lead: Lead) => void | Promise<void> }) {
  const sellers = useApi<Settings>("/api/settings").data?.sellers ?? []
  const [v, setV] = useState(() => blankFromInitial(initial))
  // Reset to the fresh initial whenever the sheet opens — so jumping between
  // conversations or leads doesn't carry stale state from a previous open.
  useEffect(() => { if (open) setV(blankFromInitial(initial)) }, [open])
  const create = useAction(api.create)

  async function submit() {
    if (!v.name) return
    const body = {
      ...v,
      interested_products: v.interested_products.split(",").map(s => s.trim()).filter(Boolean),
      created_at: new Date().toISOString(),
      last_touch_at: new Date().toISOString(),
    }
    const r = await create.run("leads", body)
    if (r) {
      onOpenChange(false)
      if (onCreated) await onCreated(r as Lead)
      else refresh()
    }
  }

  const isPhoneHandle = v.phone.startsWith("@") || v.phone.includes("instagram") || v.source === "Instagram"

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Nuevo lead" description="Contacto pre-cotización" onSubmit={submit} busy={create.busy} error={create.error}>
      <div>
        <FieldLabel>Nombre</FieldLabel>
        <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Juan Pérez / Estudio Tal" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Teléfono</FieldLabel>
          <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="+54 9 11 …" />
        </div>
        <div>
          <FieldLabel>Email</FieldLabel>
          <Input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="contacto@ejemplo.com" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Origen</FieldLabel>
          <select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value as any })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>Vendedor asignado</FieldLabel>
          <select value={v.assigned_seller} onChange={(e) => setV({ ...v, assigned_seller: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">— Sin asignar —</option>
            {sellers.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <FieldLabel>Productos de interés</FieldLabel>
        <Input value={v.interested_products} onChange={(e) => setV({ ...v, interested_products: e.target.value })} placeholder="H2O, Roble Eslavonia, Madera…" />
        <p className="text-xs text-muted-foreground mt-1">Separado por comas</p>
      </div>
      <div>
        <FieldLabel>Estado inicial</FieldLabel>
        <select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as LeadStatus })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      <div>
        <FieldLabel>Dirección / Obra</FieldLabel>
        <Input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} placeholder="Av. del Libertador 1234 / Casa Pilar" />
      </div>
      <div>
        <FieldLabel>Notas</FieldLabel>
        <Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="Pidió presupuesto para Obra Pilar, 80 m²…" />
      </div>
      {isPhoneHandle && (
        <p className="text-[11px] text-muted-foreground">Tip: para leads de Instagram, dejá el handle en notas y pedile el WhatsApp/email para completar los campos de contacto.</p>
      )}
    </FormSheet>
  )
}
