// Utilidades del calendario de colocaciones (Agenda). Extrae los helpers de fecha que vivían
// inline en AgendaPage y suma el sistema de color del handoff de diseño (colores por equipo y por
// tipo de evento, estado, material) + derivación de "diseño" desde los ítems de la venta.
// Los colores son hex (acentos de identidad) — se usan por style inline; el resto del chrome usa
// los tokens de tema de la app (--background/--foreground/--border…) para respetar claro/oscuro.

import type { Sale, SaleItem, Product } from "./types"

// ---------- Colores de identidad (del Pacific Design System) ----------
// Color por equipo/colocador. Elegidos de la paleta de maderas para quedar "en familia".
export const CREW_COLORS: Record<string, string> = {
  "Hugo Ramirez": "#A8855C",          // oak
  "Gastón Aguilera": "#585C5E",       // slate
  "Ariel Ernesto Garcia": "#7C3B27",  // lapacho
  "Fabián Ortiz": "#55684F",          // muted sage
}
export const CREW_FALLBACK = "#9E978E" // Sin asignar / Externo (ink-400 neutro)
export function crewColor(name?: string | null): string {
  if (!name) return CREW_FALLBACK
  return CREW_COLORS[name] ?? CREW_FALLBACK
}
// Iniciales de 2 letras para el avatar del equipo.
export function crewInitials(name?: string | null): string {
  if (!name) return "—"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// Color por tipo de evento (distinto de los colores de equipo). Obra/entrega usa el color del equipo.
export const EVENT_COLORS: Record<string, string> = {
  container: "#3B5A73",
  medicion: "#6B4C7A",
  remito: "#3C6E47",
  reparacion: "#B07A2B",
  ausencia: "#6B655D",
  todo: "#7A746C",     // tarea/recordatorio del vendedor (bot de WhatsApp) — solo vista Lista
  obra: "#3D3935",   // fallback de obra sin equipo (ink-700)
}

// Acento por estado de la obra (para el badge). Se renderiza como tint(hue,α) + texto en hue,
// así funciona tanto en claro como en oscuro.
export const ESTADO_COLOR: Record<string, string> = {
  Confirmado: "#57524C",
  Programado: "#7A746C",
  "En proceso": "#B07A2B",
  Finalizado: "#3C6E47",
  Cancelado: "#9B3024",
}
// Color del punto de estado de material.
export const MATERIAL_COLOR: Record<string, string> = {
  full: "#3C6E47",     // Entregado
  partial: "#B07A2B",  // Parcial
  none: "#9E978E",     // Sin entregar
}
export const MATERIAL_LABEL: Record<string, string> = { full: "Entregado", partial: "Parcial", none: "Sin entregar" }
// Estado de entrega del material derivado (mismo criterio que VentasPage): solo señales reales.
export function materialState(s: Sale): "full" | "partial" | "none" {
  if (s.stock_deducted || s.status === "Finalizado") return "full"
  if ((s.material_deliveries?.length ?? 0) > 0) return "partial"
  return "none"
}

// tint(hex, alpha) → rgba con el mismo hue a baja opacidad (fondos de badges/pills/celdas).
export function tint(hex: string, alpha: number): string {
  const h = hex.replace("#", "")
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ---------- Helpers de fecha (semana empieza lunes) ----------
export const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

export function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1) }
export function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1) }
export function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
export function dayKey(d: Date) { return d.toISOString().slice(0, 10) }
// Lunes de la semana que contiene d.
export function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (x.getDay() + 6) % 7   // 0=Lun … 6=Dom
  x.setDate(x.getDate() - dow)
  return x
}
export function weekDays(cursor: Date): Date[] {
  const mon = startOfWeek(cursor)
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
}
// Grilla mensual de 42 días (6 semanas), lunes primero.
export function daysGrid(month: Date): { date: Date; inMonth: boolean; key: string }[] {
  const first = startOfMonth(month)
  const firstDow = (first.getDay() + 6) % 7
  const start = addDays(first, -firstDow)
  return Array.from({ length: 42 }, (_, i) => {
    const d = addDays(start, i)
    return { date: d, inMonth: d.getMonth() === month.getMonth(), key: dayKey(d) }
  })
}
export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
export function isToday(d: Date) { return isSameDay(d, new Date()) }

// ---------- Colocación (obra) derivada de una venta ----------
export type Placement = { start: Date; end: Date; startStr: string; endStr: string; totalDays: number; crew?: string | null }
export function saleToPlacement(s: Sale): Placement | null {
  if (!s.delivery_date) return null
  const startStr = s.delivery_date.slice(0, 10)
  const endStr = s.delivery_date_to && s.delivery_date_to.slice(0, 10) >= startStr ? s.delivery_date_to.slice(0, 10) : startStr
  const start = new Date(startStr + "T12:00:00")
  const end = new Date(endStr + "T12:00:00")
  const totalDays = Math.max(1, Math.round((+end - +start) / 86400000) + 1)
  return { start, end, startStr, endStr, totalDays, crew: s.delivery_crew }
}
// ¿La colocación toca ese día? (para ocupación en la vista Equipos)
export function placementCoversDay(p: Placement, day: Date): boolean {
  const k = dayKey(day)
  return k >= p.startStr && k <= p.endStr
}

// ---------- "Diseño" específico de la obra (derivado de los ítems de piso) ----------
// Devuelve los diseños de piso de una venta: nombre del producto (stockTrack) si está vinculado,
// o el texto de la descripción como fallback. No inventa un campo "diseño" — lo deriva.
const SVC_RX = /colocaci|entrega|ajuste|medici|reparaci|servicio|mano de obra|flete|descuento|adicional|visita/i
export function deriveDesigns(items: SaleItem[] | undefined, products: Product[]): { design: string; m2: number }[] {
  if (!items?.length) return []
  const bySku = new Map(products.map(p => [p.sku, p]))
  const byId = new Map(products.map(p => [p.id, p]))
  const out: { design: string; m2: number }[] = []
  for (const it of items) {
    const qty = Number(it.quantity) || 0
    if (qty <= 0) continue
    const p = (it.product_id && byId.get(it.product_id)) || (it.sku && bySku.get(it.sku)) || null
    if (p) {
      if (!p.stockTrack) continue                      // servicios/extras no son "diseño"
      out.push({ design: p.name, m2: qty })
    } else {
      if (SVC_RX.test(it.description || "")) continue   // línea de servicio sin producto
      out.push({ design: (it.description || "—").trim(), m2: qty })
    }
  }
  return out
}
// Lista única de diseños presentes en un conjunto de ventas (para el filtro).
export function designsInSales(sales: Sale[], products: Product[]): string[] {
  const set = new Set<string>()
  for (const s of sales) for (const d of deriveDesigns(s.items, products)) set.add(d.design)
  return [...set].sort()
}
