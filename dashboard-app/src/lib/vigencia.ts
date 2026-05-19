import type { Quote } from "./types"

export const DEFAULT_VALID_DAYS = 10

/** The reference date used to compute when a quote expires. */
export function effectiveIssuedDate(q: Quote): Date {
  return new Date(q.renewed_at || q.created_at)
}

export function validUntil(q: Quote, defaultDays = DEFAULT_VALID_DAYS): Date {
  const issued = effectiveIssuedDate(q)
  const days = q.valid_days ?? defaultDays
  return new Date(+issued + days * 86400000)
}

/** True when the cotización is still in a state where vigencia matters
 *  (Aceptado / Rechazado / Convertida are terminal). */
export function vigenciaApplies(q: Quote): boolean {
  const s = q.status
  if (s === "Aceptado" || s === "ACCEPTED") return false
  if (s === "Rechazado" || s === "REJECTED") return false
  if (q.sale_id) return false
  return true
}

export type VigenciaState =
  | { kind: "n/a" }
  | { kind: "vigente"; daysLeft: number; until: Date }
  | { kind: "por-vencer"; daysLeft: number; until: Date }
  | { kind: "vencida"; daysOverdue: number; until: Date }

export function vigenciaState(q: Quote, today = new Date()): VigenciaState {
  if (!vigenciaApplies(q)) return { kind: "n/a" }
  const until = validUntil(q)
  const ms = +until - +today
  const days = Math.ceil(ms / 86400000)
  if (days < 0) return { kind: "vencida", daysOverdue: -days, until }
  if (days <= 3) return { kind: "por-vencer", daysLeft: days, until }
  return { kind: "vigente", daysLeft: days, until }
}
