import { createContext, useContext, useEffect, useState } from "react"
import { createPortal } from "react-dom"

// SiteHeader renders TopbarActionsSlot which registers a DOM node in the context.
// Pages wrap their action JSX with <TopbarActions>...</TopbarActions> which portals
// them into the slot. No context-state changes during page renders → no cascade.
const Ctx = createContext<{
  node: HTMLDivElement | null
  setNode: (n: HTMLDivElement | null) => void
} | null>(null)

export function TopbarActionsProvider({ children }: { children: React.ReactNode }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  return <Ctx.Provider value={{ node, setNode }}>{children}</Ctx.Provider>
}

/** Rendered once by SiteHeader. Registers the slot element with the context. */
export function TopbarActionsSlot() {
  const ctx = useContext(Ctx)
  return <div ref={(el) => { if (el !== ctx?.node) ctx?.setNode(el) }} className="flex flex-wrap items-center gap-2" />
}

/** Pages wrap their topbar JSX with this. Portals into the slot once mounted. */
export function TopbarActions({ children }: { children: React.ReactNode }) {
  const ctx = useContext(Ctx)
  // After first paint, force a re-render once the slot node is ready
  const [mounted, setMounted] = useState(false)
  useEffect(() => { if (ctx?.node && !mounted) setMounted(true) }, [ctx?.node, mounted])
  if (!ctx?.node) return null
  return createPortal(children, ctx.node)
}
