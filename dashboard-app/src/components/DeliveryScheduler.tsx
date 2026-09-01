import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useApi } from "@/lib/api"
import { api, useAction } from "@/lib/mutations"
import { cn } from "@/lib/utils"
import type { Sale } from "@/lib/types"

// -----------------------------------------------------------------------------
// DeliveryScheduler — formulario ÚNICO de "programar entrega / colocación".
// Antes vivía duplicado en dos lados (el drawer del menú ⋯ en RowActions y el
// panel del detalle de la venta) con lógica de estado divergente. Esta es la
// versión rica: fecha desde/hasta, equipo, notas; al guardar rutea el estado
// (fecha ≤ hoy → En proceso; futura → Programado) y crea la Medición previa
// (−2 días) SOLO la primera vez que se agenda. El caller decide qué hacer al
// terminar (cerrar su drawer/sheet + refrescar) vía onSaved.
// -----------------------------------------------------------------------------
export function DeliveryScheduler({ sale, onSaved, actionsRight, className }: {
  sale: Sale
  onSaved: () => void
  actionsRight?: React.ReactNode
  className?: string
}) {
  const settings = useApi<{ crews?: string[] }>("/api/settings").data
  const crews = settings?.crews ?? []
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [crew, setCrew] = useState("")
  const [notes, setNotes] = useState("")
  const update = useAction(api.update)
  const txn = useAction(api.saleTransition)
  const createTask = useAction(api.create)
  const busy = update.busy || txn.busy || createTask.busy

  useEffect(() => {
    setDateFrom(sale.delivery_date ? sale.delivery_date.slice(0, 10) : "")
    setDateTo(sale.delivery_date_to ? sale.delivery_date_to.slice(0, 10) : "")
    setCrew(sale.delivery_crew ?? "")
    setNotes(sale.delivery_notes ?? "")
  }, [sale.id])

  const submit = async () => {
    if (!dateFrom) return
    const effectiveTo = dateTo && dateTo >= dateFrom ? dateTo : ""
    const isFirstSchedule = !sale.delivery_date
    const r = await update.run("sales", sale.id, {
      delivery_date: dateFrom,
      delivery_date_to: effectiveTo || undefined,
      delivery_crew: crew || undefined,
      delivery_notes: notes || undefined,
    })
    if (!r) return
    // Conexión agenda → ventas: fecha futura → Programado; fecha de hoy/pasada → En proceso.
    const today = new Date().toISOString().slice(0, 10)
    if (dateFrom <= today) { if (sale.status === "Confirmado" || sale.status === "Programado") await txn.run(sale.id, "En proceso") }
    else if (sale.status === "Confirmado") await txn.run(sale.id, "Programado")
    if (isFirstSchedule) {
      const now = new Date().toISOString()
      const m = new Date(dateFrom); m.setDate(m.getDate() - 2)
      await createTask.run("tasks", {
        type: "medicion",
        title: `Medición previa · ${sale.client_name}`,
        due_date: m.toISOString().slice(0, 10),
        assigned_seller: crew || sale.seller_name || undefined,
        status: "pendiente",
        sale_id: sale.id,
        notes: sale.client_address || "",
        created_at: now,
      })
      // El Remito se genera al completar la medición en la Agenda.
    }
    onSaved()
  }

  const clear = async () => {
    if (!confirm("¿Limpiar la fecha de entrega? Las tareas de medición / informe ya creadas siguen en la agenda — moveles la fecha o cancelálas desde ahí.")) return
    const r = await update.run("sales", sale.id, { delivery_date: "", delivery_date_to: "", delivery_crew: "", delivery_notes: "" })
    if (r) onSaved()
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1">Colocación desde</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Hasta <span className="text-muted-foreground font-normal">(opcional)</span></label>
          <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground -mt-1">Para instalaciones de varios días dejá "hasta". Al guardar: se agrega a Agenda + crea la Medición previa (−2 días). El Remito se genera cuando la medición esté completa.</div>
      <div>
        <label className="text-xs font-medium block mb-1">Equipo de colocación</label>
        {crews.length > 0 ? (
          <select value={crew} onChange={(e) => setCrew(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">— Sin asignar —</option>
            {crews.map(c => <option key={c} value={c}>{c}</option>)}
            {crew && !crews.includes(crew) && crew !== "Externo" && <option value={crew}>{crew}</option>}
            <option value="Externo">Externo / otro</option>
          </select>
        ) : (
          <Input value={crew} onChange={(e) => setCrew(e.target.value)} placeholder="Equipo" />
        )}
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Notas de entrega</label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ascensor de carga, llaves con portero…" />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button onClick={submit} disabled={busy || !dateFrom}>
          {busy ? "Guardando…" : sale.delivery_date ? "Actualizar entrega" : "Programar entrega"}
        </Button>
        {sale.delivery_date && <Button variant="outline" onClick={clear} disabled={busy}>Limpiar fecha</Button>}
        {actionsRight && <div className="ml-auto">{actionsRight}</div>}
      </div>
      {update.error && <div className="text-xs text-destructive">{update.error}</div>}
    </div>
  )
}
