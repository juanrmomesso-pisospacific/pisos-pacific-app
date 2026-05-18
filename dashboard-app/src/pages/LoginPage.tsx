import { useState } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ModeToggle } from "@/components/ModeToggle"

export default function LoginPage() {
  const { login } = useAuth()
  const { effectiveDark } = useTheme()
  const [email, setEmail] = useState("info@pisospacific.com")
  const [password, setPassword] = useState("admin123")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const r = await login(email, password)
    setBusy(false)
    if (!r.ok) setError(r.error === "invalid credentials" ? "Email o contraseña incorrectos" : r.error)
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
              <CardTitle className="text-xl">Ingresá</CardTitle>
              <CardDescription>Accedé con tu email y contraseña</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium block mb-1">Email</label>
                  <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@ejemplo.com" autoComplete="email" />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Contraseña</label>
                  <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
                </div>
                {error ? <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">{error}</div> : null}
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</Button>
              </form>
            </CardContent>
          </Card>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Cuentas de prueba</summary>
            <div className="mt-2 space-y-1 font-mono">
              <div>info@pisospacific.com · admin123</div>
              <div>juan@pisospacific.com · juan</div>
              <div>vicky@pisospacific.com · vicky</div>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
