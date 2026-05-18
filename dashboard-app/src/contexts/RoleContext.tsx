import { createContext, useContext, useEffect, useState } from "react"
import { useAuth } from "./AuthContext"

export type Role =
  | { kind: "admin"; label: "Admin" }
  | { kind: "vendor"; label: string; sellerName: string; phone?: string }

const ADMIN: Role = { kind: "admin", label: "Admin" }

const Ctx = createContext<{
  role: Role
  setRole: (r: Role) => void
  scopeBySeller: <T extends { seller_name?: string }>(rows: T[]) => T[]
  locked: boolean        // true for vendor users — they can't switch role
} | null>(null)

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { state } = useAuth()
  const authUser = state.status === "ready" ? state.user : null

  // Vendors are locked to their own role. Admins default to admin (can View As any seller).
  const initial: Role = authUser?.role === "vendor"
    ? { kind: "vendor", label: authUser.name.split(" ")[0] ?? "Vendor", sellerName: authUser.seller_name }
    : ADMIN

  const [role, setRoleState] = useState<Role>(initial)

  // When auth user changes (login/logout), reset role
  useEffect(() => {
    if (!authUser) return
    if (authUser.role === "vendor") {
      setRoleState({ kind: "vendor", label: authUser.name.split(" ")[0] ?? "Vendor", sellerName: authUser.seller_name })
    } else {
      setRoleState(ADMIN)
    }
  }, [authUser?.id, authUser?.role, authUser?.seller_name])

  const locked = authUser?.role === "vendor"
  const setRole = (r: Role) => { if (!locked) setRoleState(r) }

  const scopeBySeller = <T extends { seller_name?: string }>(rows: T[]): T[] => {
    if (role.kind === "admin") return rows
    return rows.filter((r) => r.seller_name === role.sellerName)
  }
  return <Ctx.Provider value={{ role, setRole, scopeBySeller, locked }}>{children}</Ctx.Provider>
}

export function useRole() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useRole must be used inside RoleProvider")
  return v
}
