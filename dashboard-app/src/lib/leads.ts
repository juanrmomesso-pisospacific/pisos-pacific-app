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
