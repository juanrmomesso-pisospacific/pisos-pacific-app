import { createContext, useContext, useEffect, useState } from "react"

export type AuthUser = {
  id: string
  email: string
  name: string
  role: "admin" | "vendor" | "logistica"
  seller_name: string
}

type AuthState =
  | { status: "loading"; user: null }
  | { status: "anon"; user: null }
  | { status: "ready"; user: AuthUser }

const Ctx = createContext<{
  state: AuthState
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>
  logout: () => Promise<void>
} | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null })

  async function refresh() {
    try {
      const r = await fetch("/api/auth/me", { credentials: "include" })
      if (r.status === 401) { setState({ status: "anon", user: null }); return }
      const { user } = await r.json()
      setState({ status: "ready", user })
    } catch {
      setState({ status: "anon", user: null })
    }
  }

  useEffect(() => { refresh() }, [])

  async function login(email: string, password: string) {
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        return { ok: false as const, error: body?.error ?? `HTTP ${r.status}` }
      }
      const { user } = await r.json()
      setState({ status: "ready", user })
      return { ok: true as const }
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "network error" }
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    setState({ status: "anon", user: null })
  }

  return <Ctx.Provider value={{ state, login, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useAuth must be used inside AuthProvider")
  return v
}
