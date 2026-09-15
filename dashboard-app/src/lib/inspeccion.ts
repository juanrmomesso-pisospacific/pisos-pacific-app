// Protocolo de inspección de obra (checklist de la medición). Los ítems y grupos se definen
// una sola vez acá (front) y se espejan en pdf/inspeccion.mjs (back) para el PDF imprimible.
export type ChecklistValue = "si" | "no" | "na"
export type ChecklistEntry = { v?: ChecklistValue; note?: string }
export type Checklist = Record<string, ChecklistEntry>

export type InspItem = { key: string; label: string; hint?: string }
export type InspGroup = { title: string; items: InspItem[] }

export const INSPECCION_GROUPS: InspGroup[] = [
  {
    title: "Acceso y logística",
    items: [
      { key: "horario", label: "Horario permitido de trabajo" },
      { key: "seguros", label: "Seguros (ART / RC) requeridos" },
      { key: "residuos", label: "Lugar para dejar residuos", hint: "Averiguar dónde se dejan los residuos de piso e insumos" },
      { key: "muebles", label: "Movimiento de muebles", hint: "¿Lo hace el cliente o nosotros?" },
    ],
  },
  {
    title: "Contrapiso / superficie",
    items: [
      { key: "carpeta_plana", label: "Carpeta plana y limpia" },
      { key: "altura_carpeta", label: "Altura de carpeta (nivel final)" },
      { key: "obra_humeda", label: "Obra húmeda terminada" },
      { key: "calefaccion", label: "Calefacción / losa radiante" },
      { key: "piso_existente", label: "Piso existente (¿se remueve?)" },
    ],
  },
  {
    title: "Terminaciones del entorno",
    items: [
      { key: "aberturas", label: "Aberturas instaladas" },
      { key: "pintura", label: "2 manos de pintura terminadas" },
      { key: "marcos", label: "Marcos de puerta para cortar", hint: "Deben tener altura para que pase el piso por abajo" },
      { key: "puertas_cepillar", label: "Puertas para cepillar" },
      { key: "puerta_blindada", label: "Puerta blindada" },
      { key: "encuentros_banos", label: "Encuentros con baños" },
    ],
  },
  {
    title: "Terminaciones a definir",
    items: [
      { key: "varillas", label: "Varillas de transición" },
      { key: "cuartacana", label: "Cuartacaña / contrazócalos", hint: "Donde por altura del zócalo no entra (ej. puertas ventana)" },
    ],
  },
]

// Lista plana de keys (para iterar / validar). El orden sigue los grupos.
export const INSPECCION_ITEMS: InspItem[] = INSPECCION_GROUPS.flatMap((g) => g.items)

export const CHECK_LABEL: Record<ChecklistValue, string> = { si: "Sí", no: "No", na: "N/A" }

/** Cuántos ítems del checklist están respondidos (para el resumen "12/17"). */
export function checklistDone(cl?: Checklist): number {
  if (!cl) return 0
  return INSPECCION_ITEMS.filter((it) => cl[it.key]?.v).length
}
