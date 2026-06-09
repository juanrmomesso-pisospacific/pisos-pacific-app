import { useState } from "react"
import { useTheme } from "@/contexts/ThemeContext"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function ResetPasswordPage() {
  const { effectiveDark } = useTheme()
  const token = new URLSearchParams(window.location.search).get("token") || ""
  const [pw, setPw] = useState("")
  const [pw2, setPw2] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (pw.length < 6) return setError("La contraseña debe tener al menos 6 caracteres")
    if (pw !== pw2) return setError("Las contraseñas no coinciden")
    setBusy(true)
    try {
      const r = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password: pw }) })
      if (!r.ok) { const b = await r.json().catch(() => ({})); setError(b.error || "No se pudo resetear"); return }
      setDone(true)
    } catch { setError("Error de red") } finally { setBusy(false) }
  }

  const logo = effectiveDark ? "/LogoPacific.png" : "/LogoPacificDark.png"

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex justify-center"><img src={logo} alt="Pisos Pacific" className="max-w-[180px] h-auto" /></div>
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Nueva contraseña</CardTitle>
              <CardDescription>Creá tu nueva contraseña</CardDescription>
            </CardHeader>
            <CardContent>
              {!token ? (
                <div className="text-sm text-destructive">Link inválido. Pedí uno nuevo desde "¿Olvidaste tu contraseña?".</div>
              ) : done ? (
                <div className="space-y-4">
                  <div className="text-sm text-emerald-700">✓ Contraseña actualizada. Ya podés ingresar.</div>
                  <Button className="w-full" onClick={() => { window.location.href = "/" }}>Ir al login</Button>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <div>
                    <label className="text-sm font-medium block mb-1">Nueva contraseña</label>
                    <Input type="password" required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Repetir contraseña</label>
                    <Input type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
                  </div>
                  {error ? <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">{error}</div> : null}
                  <Button type="submit" className="w-full" disabled={busy}>{busy ? "Guardando…" : "Guardar contraseña"}</Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
