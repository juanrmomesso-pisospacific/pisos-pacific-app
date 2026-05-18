import { useState } from "react"
import { FormSheet, FieldLabel } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { api, useAction, refresh } from "@/lib/mutations"

type Client = { id?: string; name: string; dni: string; type: string; emails: string[]; phones: string[]; addresses: string[]; updated_at?: string }

export function ClientForm({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: Partial<Client> }) {
  const [v, setV] = useState<Client>({
    name: initial?.name ?? "",
    dni: initial?.dni ?? "",
    type: initial?.type ?? "client",
    emails: initial?.emails ?? [""],
    phones: initial?.phones ?? [""],
    addresses: initial?.addresses ?? [""],
  })
  const create = useAction(api.create)

  async function submit() {
    if (!v.name) return
    const body = {
      ...v,
      emails: v.emails.filter(Boolean),
      phones: v.phones.filter(Boolean),
      addresses: v.addresses.filter(Boolean),
      updated_at: new Date().toISOString(),
    }
    const r = await create.run("clients", body)
    if (r) { onOpenChange(false); refresh() }
  }

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Nuevo cliente" onSubmit={submit} busy={create.busy} error={create.error}>
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
    </FormSheet>
  )
}
