export type TaskType = "medicion" | "entrega" | "remito" | "visita" | "seguimiento" | "reparacion" | "ausencia" | "todo" | "otro"
export type TaskStatus = "pendiente" | "completada" | "cancelada"

/** Captured during the on-site measurement visit. Stored on both task.medicion_data
 *  and the linked sale.medicion_data so the Remito can prefill from it. */
export type MedicionExtra = { description: string; quantity: number; sku?: string }
export type MedicionData = {
  m2_medidos?: number
  m2_cotizados?: number       // snapshot of the quoted total for side-by-side comparison
  superficie?: string
  observaciones?: string
  extras?: string             // legacy free-text (kept for back-compat — new flow uses extras_items)
  extras_items?: MedicionExtra[]
  recorded_at?: string
  recorded_by?: string
}

export type Task = {
  id: string
  type: TaskType
  title: string
  due_date: string
  due_date_to?: string        // opcional: fin de ventana (reparación/ausencia multi-día). undefined = 1 día
  assigned_seller?: string
  status: TaskStatus
  sale_id?: string
  lead_id?: string
  notes?: string
  created_at: string
  completed_at?: string
  medicion_data?: MedicionData
}

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  medicion: "Medición previa",
  entrega: "Entrega",
  remito: "Remito",
  visita: "Visita / showroom",
  seguimiento: "Seguimiento",
  reparacion: "Reparación",
  ausencia: "Ausencia",
  todo: "Tarea",
  otro: "Otro",
}

// User-facing creation picker — visita + seguimiento removed; entrega is created via
// Programar entrega flow on a Sale, not as an ad-hoc task. Reparación (posventa) y Ausencia
// (vacaciones/franco) ocupan al equipo asignado en la vista de disponibilidad. "todo" =
// tarea/recordatorio del vendedor (bot de WhatsApp o Programar) — solo visible en la vista Lista.
export const TASK_TYPE_ORDER: TaskType[] = ["todo", "medicion", "reparacion", "ausencia", "remito", "otro"]
