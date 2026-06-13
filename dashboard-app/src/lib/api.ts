import { useEffect, useState } from "react"

// Extrae un mensaje de error legible: el campo `error` del JSON del backend si existe,
// un texto claro para 401/403, o el código HTTP como último recurso.
export async function errorMessage(r: Response): Promise<string> {
  if (r.status === 401 || r.status === 403) return "Sesión expirada — volvé a iniciar sesión"
  try { const b = await r.clone().json(); if (b && typeof b.error === "string") return b.error } catch { /* respuesta no-JSON */ }
  return `Error ${r.status}`
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" })
  if (!r.ok) throw new Error(await errorMessage(r))
  return r.json() as Promise<T>
}

// opts.pollMs: re-pide los datos cada N ms (auto-refresh sin recargar la página).
export function useApi<T>(url: string, opts?: { pollMs?: number }): { data: T | null; loading: boolean; error: Error | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let cancelled = false
    getJSON<T>(url)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e); setLoading(false) } })
    return () => { cancelled = true }
  }, [url, nonce])
  // Polling: dispara un refetch periódico. No toca `loading` → no hay flash de "Cargando".
  const pollMs = opts?.pollMs
  useEffect(() => {
    if (!pollMs) return
    const id = setInterval(() => setNonce((n) => n + 1), pollMs)
    return () => clearInterval(id)
  }, [pollMs])
  // refetch: re-pide los datos sin recargar la página (evita el flash/scroll del reload).
  return { data, loading, error, refetch: () => setNonce((n) => n + 1) }
}

export { getJSON }
