import { useEffect, useState } from "react"

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" })
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
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
