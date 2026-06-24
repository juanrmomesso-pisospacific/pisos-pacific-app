export type LeadStatus = "New" | "Contacted" | "Quoted" | "Won" | "Lost"

export type Lead = {
  id: string
  name: string
  phone?: string
  email?: string
  source: string
  interested_products: string[]
  notes?: string
  status: LeadStatus
  assigned_seller?: string
  created_at: string
  last_touch_at: string
  // Web form (pisospacific.com/cotiza) — only set when source === "Web"
  address?: string
  approx_m2?: number
  needs_placement?: boolean
}

export const STATUS_ORDER: LeadStatus[] = ["New", "Contacted", "Quoted", "Won", "Lost"]
export const STATUS_LABEL: Record<LeadStatus, string> = {
  New: "Nuevo",
  Contacted: "Contactado",
  Quoted: "Cotizado",
  Won: "Ganado",
  Lost: "Perdido",
}
export const SOURCES = ["WhatsApp", "Instagram", "Web", "Referral", "Walk-in", "Other"] as const

// ¿El nombre parece un usuario de Instagram / id de contacto en vez de un nombre real?
// (empieza con @, es todo dígitos/símbolos, o no tiene ninguna letra). Para avisar al cotizar
// que conviene poner el nombre real del cliente antes de generar el presupuesto.
export function looksLikeHandle(name?: string): boolean {
  const n = (name || "").trim()
  if (!n) return false
  if (n.startsWith("@")) return true
  if (/^[\d\s+()-]+$/.test(n)) return true   // solo números/símbolos (id o teléfono)
  if (!/[a-zá-úñ]/i.test(n)) return true       // sin ninguna letra
  return false
}
