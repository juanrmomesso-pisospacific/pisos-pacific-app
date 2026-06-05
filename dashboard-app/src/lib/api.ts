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

export function useApi<T>(url: string): { data: T | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  useEffect(() => {
    let cancelled = false
    getJSON<T>(url)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e); setLoading(false) } })
    return () => { cancelled = true }
  }, [url])
  return { data, loading, error }
}

export { getJSON }
