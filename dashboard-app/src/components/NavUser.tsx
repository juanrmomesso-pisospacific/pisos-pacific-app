import { useState } from "react"
import { ChevronsUpDown, LogOut, KeyRound } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { SidebarMenuButton } from "@/components/ui/sidebar"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormError } from "@/components/FormError"
import { useAuth } from "@/contexts/AuthContext"
import { ROLE_LABEL } from "@/lib/access"

function ChangePasswordSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setError(null)
    if (next.length < 6) return setError("La nueva contraseña debe tener al menos 6 caracteres")
    if (next !== confirm) return setError("Las contraseñas no coinciden")
    setBusy(true)
    try {
      const r = await fetch("/api/auth/change-password", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, new: next }) })
      if (!r.ok) { const b = await r.json().catch(() => ({})); setError(b.error || "No se pudo cambiar"); return }
      setDone(true); setCurrent(""); setNext(""); setConfirm("")
    } catch { setError("Error de red") } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setDone(false); setError(null) } }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Cambiar contraseña</SheetTitle>
          <SheetDescription>Actualizá tu contraseña de acceso.</SheetDescription>
        </SheetHeader>
        {done ? (
          <div className="mt-6 text-sm text-emerald-700">✓ Contraseña actualizada.</div>
        ) : (
          <div className="mt-6 space-y-4">
            <div><label className="text-sm font-medium block mb-1">Contraseña actual</label><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></div>
            <div><label className="text-sm font-medium block mb-1">Nueva contraseña</label><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></div>
            <div><label className="text-sm font-medium block mb-1">Repetir nueva</label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></div>
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button size="sm" onClick={submit} disabled={busy}>{busy ? "Guardando…" : "Cambiar"}</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

export function NavUser() {
  const { state, logout } = useAuth()
  const user = state.status === "ready" ? state.user : null
  const name = user?.name ?? "—"
  const email = user?.email ?? ""
  const initials = name.split(" ").map((w) => w[0]?.toUpperCase()).slice(0, 2).join("")
  const [openPw, setOpenPw] = useState(false)

  return (
    <>
      <ChangePasswordSheet open={openPw} onOpenChange={setOpenPw} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
            <div className="h-8 w-8 rounded-full bg-muted text-foreground flex items-center justify-center text-xs font-medium shrink-0">
              {initials}
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight min-w-0">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-xs text-muted-foreground">{email}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-56">
          <DropdownMenuLabel>{ROLE_LABEL[user?.role ?? ""] ?? "Vendedor"}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpenPw(true)}>
            <KeyRound className="h-4 w-4 mr-2" /> Cambiar contraseña
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => logout()}>
            <LogOut className="h-4 w-4 mr-2" /> Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
