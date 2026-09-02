import { useState } from "react"
import { Trash2, Plus } from "lucide-react"
import { FormSheet, FieldLabel } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { api, useAction, refresh } from "@/lib/mutations"
import { DEFAULT_REVENTA, type ResellerFields, type VolumeTier, type CommissionTier } from "@/lib/reseller"

type Client = {
  id?: string; name: string; dni: string; type: string
  emails: string[]; phones: string[]; addresses: string[]; updated_at?: string
} & ResellerFields

export function ClientForm({ open, onOpenChange, initial, editClient }: {
  open: boolean; onOpenChange: (o: boolean) => void; initial?: Partial<Client>; editClient?: Client
}) {
  const isEdit = !!editClient
  const src = editClient ?? initial
  const [v, setV] = useState<Client>({
    name: src?.name ?? "",
    dni: src?.dni ?? "",
    type: src?.type ?? "client",
    emails: src?.emails?.length ? src.emails : [""],
    phones: src?.phones?.length ? src.phones : [""],
    addresses: src?.addresses?.length ? src.addresses : [""],
    reseller: src?.reseller ?? false,
    reseller_mode: src?.reseller_mode ?? "reventa",
    reseller_reventa: src?.reseller_reventa ?? DEFAULT_REVENTA,
    reseller_comision: src?.reseller_comision ?? { type: "pct", pct: 10 },
  })
  const create = useAction(api.create)
  const update = useAction(api.update)
  const action = isEdit ? update : create

  async function submit() {
    if (!v.name) return
    const reventa = v.reseller_reventa ?? DEFAULT_REVENTA
    const comision = v.reseller_comision ?? { type: "pct", pct: 0 }
    const body = {
      ...v,
      emails: v.emails.filter(Boolean),
      phones: v.phones.filter(Boolean),
      addresses: v.addresses.filter(Boolean),
      // Solo persistimos la config del modo activo (limpia la otra para no confundir).
      reseller: !!v.reseller,
      reseller_mode: v.reseller ? v.reseller_mode : undefined,
      reseller_reventa: v.reseller && v.reseller_mode === "reventa" ? reventa : undefined,
      reseller_comision: v.reseller && v.reseller_mode === "comision" ? comision : undefined,
      updated_at: new Date().toISOString(),
    }
    const r = isEdit ? await update.run("clients", editClient!.id!, body) : await create.run("clients", body)
    if (r) { onOpenChange(false); refresh() }
  }

  // --- editores de la config ---
  const reventa = v.reseller_reventa ?? DEFAULT_REVENTA
  const setReventa = (patch: Partial<typeof reventa>) => setV({ ...v, reseller_reventa: { ...reventa, ...patch } })
  const setVolTier = (i: number, patch: Partial<VolumeTier>) =>
    setReventa({ tiers: reventa.tiers.map((t, idx) => idx === i ? { ...t, ...patch } : t) })
  const addVolTier = () => setReventa({ tiers: [...reventa.tiers, { upto_m2: null, extra_pct: 0 }] })
  const rmVolTier = (i: number) => setReventa({ tiers: reventa.tiers.filter((_, idx) => idx !== i) })

  const comision = v.reseller_comision ?? { type: "pct" as const, pct: 0 }
  const setComision = (patch: Partial<typeof comision>) => setV({ ...v, reseller_comision: { ...comision, ...patch } })
  const comTiers: CommissionTier[] = comision.tiers ?? [{ upto_m2: 300, per_m2: 3 }, { upto_m2: null, per_m2: 4 }]
  const setComTier = (i: number, patch: Partial<CommissionTier>) =>
    setComision({ tiers: comTiers.map((t, idx) => idx === i ? { ...t, ...patch } : t) })
  const addComTier = () => setComision({ tiers: [...comTiers, { upto_m2: null, per_m2: 0 }] })
  const rmComTier = (i: number) => setComision({ tiers: comTiers.filter((_, idx) => idx !== i) })

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={isEdit ? `Editar · ${editClient!.name}` : "Nuevo cliente"}
      onSubmit={submit} busy={action.busy} error={action.error}>
      <div>
        <FieldLabel>Nombre</FieldLabel>
        <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Juan Pérez / Estudio Tal" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>DNI / CUIT</FieldLabel>
          <Input value={v.dni} onChange={(e) => setV({ ...v, dni: e.target.value })} />
        </div>
        <div>
          <FieldLabel>Tipo</FieldLabel>
          <select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="client">Cliente</option>
            <option value="lead">Lead</option>
            <option value="supplier">Proveedor</option>
          </select>
        </div>
      </div>
      <div>
        <FieldLabel>Email</FieldLabel>
        <Input value={v.emails[0] ?? ""} onChange={(e) => setV({ ...v, emails: [e.target.value] })} placeholder="contacto@cliente.com" />
      </div>
      <div>
        <FieldLabel>Teléfono</FieldLabel>
        <Input value={v.phones[0] ?? ""} onChange={(e) => setV({ ...v, phones: [e.target.value] })} placeholder="+54 9 11 …" />
      </div>
      <div>
        <FieldLabel>Dirección / obra</FieldLabel>
        <Input value={v.addresses[0] ?? ""} onChange={(e) => setV({ ...v, addresses: [e.target.value] })} placeholder="Obra Pilar / Calle X 1234" />
      </div>

      {/* ---- Revendedor ---- */}
      <div className="rounded-md border border-border p-3 space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={!!v.reseller} onChange={(e) => setV({ ...v, reseller: e.target.checked })} />
          Es revendedor
        </label>
        {v.reseller && (
          <>
            <div className="inline-flex rounded-md border border-input overflow-hidden text-xs">
              <button type="button" onClick={() => setV({ ...v, reseller_mode: "reventa" })} className={`px-3 h-8 ${v.reseller_mode === "reventa" ? "bg-foreground text-background" : "bg-transparent"}`}>Mayorista (nos compra)</button>
              <button type="button" onClick={() => setV({ ...v, reseller_mode: "comision" })} className={`px-3 h-8 ${v.reseller_mode === "comision" ? "bg-foreground text-background" : "bg-transparent"}`}>Comisión (trae cliente)</button>
            </div>

            {v.reseller_mode === "reventa" ? (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">Precio distribuidor = lista − (acuerdo + volumen). El descuento aplica <b>solo a los pisos</b>; servicios y accesorios van a lista.</p>
                <div>
                  <FieldLabel>Descuento por acuerdo (%)</FieldLabel>
                  <Input type="number" min={0} max={100} step="0.5" value={reventa.desc_acuerdo} onChange={(e) => setReventa({ desc_acuerdo: Number(e.target.value) || 0 })} className="h-8 w-32" />
                </div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Descuento adicional por volumen (m² de piso)</div>
                <div className="space-y-1">
                  {reventa.tiers.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-[11px] text-muted-foreground w-14">hasta</span>
                      <Input type="number" min={0} value={t.upto_m2 ?? ""} placeholder="∞" onChange={(e) => setVolTier(i, { upto_m2: e.target.value === "" ? null : Number(e.target.value) })} className="h-8 w-24" />
                      <span className="text-[11px] text-muted-foreground">m² →</span>
                      <Input type="number" min={0} step="0.5" value={t.extra_pct} onChange={(e) => setVolTier(i, { extra_pct: Number(e.target.value) || 0 })} className="h-8 w-20" />
                      <span className="text-[11px] text-muted-foreground">% extra</span>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 ml-auto" onClick={() => rmVolTier(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="outline" onClick={addVolTier}><Plus className="h-3.5 w-3.5" />Agregar tramo</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">La comisión se calcula <b>solo sobre los pisos</b> (no servicios ni accesorios). El cliente paga precio de lista.</p>
                <div>
                  <FieldLabel>Tipo de comisión</FieldLabel>
                  <select value={comision.type} onChange={(e) => setComision({ type: e.target.value as ComisionType })} className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                    <option value="pct">% del monto de pisos</option>
                    <option value="per_m2">$ por m² de piso</option>
                    <option value="tiered_m2">Escala por m² (tramos)</option>
                  </select>
                </div>
                {comision.type === "pct" && (
                  <div><FieldLabel>Porcentaje (%)</FieldLabel>
                    <Input type="number" min={0} step="0.5" value={comision.pct ?? 0} onChange={(e) => setComision({ pct: Number(e.target.value) || 0 })} className="h-8 w-32" /></div>
                )}
                {comision.type === "per_m2" && (
                  <div><FieldLabel>Monto por m² (moneda del ítem)</FieldLabel>
                    <Input type="number" min={0} step="0.1" value={comision.per_m2 ?? 0} onChange={(e) => setComision({ per_m2: Number(e.target.value) || 0 })} className="h-8 w-32" /></div>
                )}
                {comision.type === "tiered_m2" && (
                  <div className="space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Escala: $/m² por tramo de m² de piso</div>
                    {comTiers.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="text-[11px] text-muted-foreground w-14">hasta</span>
                        <Input type="number" min={0} value={t.upto_m2 ?? ""} placeholder="∞" onChange={(e) => setComTier(i, { upto_m2: e.target.value === "" ? null : Number(e.target.value) })} className="h-8 w-24" />
                        <span className="text-[11px] text-muted-foreground">m² →</span>
                        <Input type="number" min={0} step="0.1" value={t.per_m2} onChange={(e) => setComTier(i, { per_m2: Number(e.target.value) || 0 })} className="h-8 w-20" />
                        <span className="text-[11px] text-muted-foreground">$/m²</span>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 ml-auto" onClick={() => rmComTier(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="outline" onClick={addComTier}><Plus className="h-3.5 w-3.5" />Agregar tramo</Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </FormSheet>
  )
}

type ComisionType = "pct" | "per_m2" | "tiered_m2"
