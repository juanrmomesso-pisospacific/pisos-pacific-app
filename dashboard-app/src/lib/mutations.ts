import { useState } from "react"
import { errorMessage } from "./api"

async function post<T = any>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(await errorMessage(r))
  return r.json()
}
async function patch<T = any>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(await errorMessage(r))
  return r.json()
}

export function useAction<TArgs extends any[], TResult>(fn: (...args: TArgs) => Promise<TResult>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (...args: TArgs): Promise<TResult | null> => {
    setBusy(true); setError(null)
    try { return await fn(...args) } catch (e: any) { setError(e?.message ?? String(e)); return null } finally { setBusy(false) }
  }
  return { run, busy, error }
}

export const api = {
  // Quote actions
  quoteTransition: (id: string, status: string) => post(`/api/quotes/${id}/transition`, { status }),
  quoteConvert:    (id: string) => post(`/api/quotes/${id}/convert`),
  quoteDuplicate:  (id: string) => post(`/api/quotes/${id}/duplicate`),
  // Sale actions
  saleTransition:  (id: string, status: string) => post(`/api/sales/${id}/transition`, { status }),
  salePayment:     (id: string, amount: number, method?: string, notes?: string) =>
    post(`/api/sales/${id}/payment`, { amount, method, notes }),
  // Container actions
  containerReceive: (id: string) => post(`/api/containers/${id}/receive`),
  containerCreate:  (body: any) => post(`/api/containers`, body),
  // MercadoPago — T6.A
  paymentLinkCreate:   (saleId: string, amount?: number) => post(`/api/sales/${saleId}/payment-link`, amount != null ? { amount } : undefined),
  paymentLinkSimulate: (linkId: string) => post(`/api/payment-links/${linkId}/simulate-paid`),
  // Importar extractos (MP / BBVA / Banco de Comercio)
  importParse:  (source: string, data_base64: string) => post(`/api/import/parse`, { source, data_base64 }),
  importCommit: (movements: any[]) => post(`/api/import/commit`, { movements }),
  // Generic CRUD
  create: (entity: string, body: any) => post(`/api/${entity}`, body),
  update: (entity: string, id: string, body: any) => patch(`/api/${entity}/${id}`, body),
}

/** Reload the page after a successful mutation so all useApi() hooks refetch. Crude but reliable. */
export function refresh() { window.location.reload() }
