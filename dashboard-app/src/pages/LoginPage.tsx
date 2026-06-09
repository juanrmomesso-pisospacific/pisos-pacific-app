import { useState } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormError } from "@/components/FormError"
import { ModeToggle } from "@/components/ModeToggle"

export default function LoginPage() {
  const { login } = useAuth()
  const { effectiveDark } = useTheme()
  const [mode, setMode] = useState<"login" | "forgot">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const r = await login(email, password)
    setBusy(false)
    if (!r.ok) setError(r.error === "invalid credentials" ? "Email o contraseña incorrectos" : r.error)
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      await fetch("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) })
      setNotice("Si el email está registrado, te enviamos un link para crear una nueva contraseña. Revisá tu correo.")
    } catch { setError("No se pudo enviar. Probá de nuevo.") }
    finally { setBusy(false) }
  }

  const logo = effectiveDark ? "/LogoPacific.png" : "/LogoPacificDark.png"

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="absolute top-4 right-4"><ModeToggle /></div>
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex justify-center">
            <img src={logo} alt="Pisos Pacific" className="max-w-[180px] h-auto" />
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">{mode === "login" ? "Ingresá" : "Recuperar contraseña"}</CardTitle>
              <CardDescription>{mode === "login" ? "Accedé con tu email y contraseña" : "Te enviamos un link a tu email para crear una nueva contraseña"}</CardDescription>
            </CardHeader>
            <CardContent>
              {mode === "login" ? (
                <form onSubmit={submit} className="space-y-4">
                  <div>
                    <label className="text-sm font-medium block mb-1">Email</label>
                    <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@ejemplo.com" autoComplete="email" />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Contraseña</label>
                    <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
                  </div>
                  <FormError>{error}</FormError>
                  <Button type="submit" className="w-full" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</Button>
                  <button type="button" onClick={() => { setMode("forgot"); setError(null); setNotice(null) }} className="text-xs text-muted-foreground hover:text-foreground w-full text-center">¿Olvidaste tu contraseña?</button>
                </form>
              ) : (
                <form onSubmit={submitForgot} className="space-y-4">
                  <div>
                    <label className="text-sm font-medium block mb-1">Email</label>
                    <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@ejemplo.com" autoComplete="email" />
                  </div>
                  <FormError>{error}</FormError>
                  {notice ? <div className="text-xs text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 rounded-md px-3 py-2">{notice}</div> : null}
                  <Button type="submit" className="w-full" disabled={busy}>{busy ? "Enviando…" : "Enviarme el link"}</Button>
                  <button type="button" onClick={() => { setMode("login"); setError(null); setNotice(null) }} className="text-xs text-muted-foreground hover:text-foreground w-full text-center">Volver al login</button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
