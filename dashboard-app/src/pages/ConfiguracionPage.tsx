import { useEffect, useState } from "react"
import { CheckCircle2, AlertCircle, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useApi } from "@/lib/api"
import { RulesManager } from "@/components/RulesManager"
import { TemplateManager } from "@/components/TemplateManager"
import { useAction, refresh } from "@/lib/mutations"
import { useAuth } from "@/contexts/AuthContext"

type MpSettings = { enabled: boolean; access_token: string; public_key: string }
type Settings = { integrations?: { mercadopago?: MpSettings } }

async function patchSettings(body: Partial<Settings>): Promise<Settings> {
  const r = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}

export default function ConfiguracionPage() {
  const settings = useApi<Settings>("/api/settings").data
  const { state } = useAuth()
  const isAdmin = state.status === "ready" && state.user.role === "admin"

  return (
    <div className="px-4 lg:px-6 space-y-4 md:space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Integraciones</CardTitle>
          <CardDescription>Conectá Pacific con los servicios externos que usan el día a día.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <MercadoPagoSection mp={settings?.integrations?.mercadopago} />
        </CardContent>
      </Card>
      <TemplateManager />
      <RulesManager />
      {isAdmin && <EmailCleanupSection />}
    </div>
  )
}

// Mantenimiento de la bandeja de email: revincula conversaciones a su lead y marca
// "Contactado" los que ya respondimos por Gmail. Hace un preview antes de aplicar.
function EmailCleanupSection() {
  const [preview, setPreview] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (commit: boolean) => {
    setBusy(true); setError(null)
    try {
      const r = await fetch("/api/admin/cleanup-email-leads", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commit }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `${r.status}`)
      if (commit) { setDone(j); setPreview(null) } else setPreview(j)
    } catch (e: any) { setError(e?.message || "error") } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Limpiar bandeja de email</CardTitle>
        <CardDescription>
          Revincula las conversaciones de email a su lead y marca como <b>Contactado</b> a los que ya respondiste
          desde Gmail (lee tu carpeta Enviados). No pisa los que ya están Cotizado/Ganado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <div className="text-sm text-destructive flex items-center gap-1.5"><AlertCircle className="h-4 w-4" />{error}</div>}
        {!preview && !done && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => run(false)}>{busy ? "Revisando…" : "Previsualizar"}</Button>
        )}
        {preview && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Encontrados <b className="text-foreground">{preview.sent_recipients}</b> destinatarios en Enviados.
              Se revincularán <b className="text-foreground">{preview.relinked}</b> conversaciones y se marcarán
              <b className="text-foreground"> {preview.contacted}</b> leads como Contactado.
              {preview.gmail_error && <span className="block text-amber-600 mt-1">⚠ No se pudo leer Gmail Enviados ({preview.gmail_error}); solo se revinculará.</span>}
            </div>
            {preview.contacted_names?.length > 0 && (
              <div className="text-xs text-muted-foreground max-h-32 overflow-y-auto border border-border rounded-md p-2">
                {preview.contacted_names.join(" · ")}
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => run(true)}>{busy ? "Aplicando…" : "Aplicar cambios"}</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPreview(null)}>Cancelar</Button>
            </div>
          </div>
        )}
        {done && (
          <div className="text-sm text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            Listo: {done.relinked} conversaciones revinculadas, {done.contacted} leads marcados como Contactado.
            <Button variant="link" size="sm" className="px-1" onClick={() => { setDone(null); refresh() }}>Actualizar</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MercadoPagoSection({ mp }: { mp?: MpSettings }) {
  const [accessToken, setAccessToken] = useState(mp?.access_token ?? "")
  const [publicKey, setPublicKey]     = useState(mp?.public_key ?? "")
  const [enabled, setEnabled]         = useState(!!mp?.enabled)
  const [saved, setSaved]             = useState(false)
  const save = useAction(patchSettings)

  useEffect(() => {
    if (mp == null) return
    setAccessToken(mp.access_token ?? "")
    setPublicKey(mp.public_key ?? "")
    setEnabled(!!mp.enabled)
  }, [mp?.access_token, mp?.public_key, mp?.enabled])

  const handleSave = async () => {
    const r = await save.run({ integrations: { mercadopago: { enabled, access_token: accessToken.trim(), public_key: publicKey.trim() } } })
    if (r) { setSaved(true); setTimeout(() => setSaved(false), 2000); refresh() }
  }

  const handleDisconnect = async () => {
    if (!confirm("¿Desconectar MercadoPago? Los links futuros se generarán en modo demo.")) return
    const r = await save.run({ integrations: { mercadopago: { enabled: false, access_token: "", public_key: "" } } })
    if (r) refresh()
  }

  const isConnected = !!(mp?.enabled && mp?.access_token)

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-start justify-between p-4 border-b border-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">MercadoPago</span>
            {isConnected
              ? <Badge variant="default" className="text-[10px] gap-1"><CheckCircle2 className="h-3 w-3" />Conectado</Badge>
              : <Badge variant="muted"   className="text-[10px] gap-1"><AlertCircle  className="h-3 w-3" />Modo demo</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">Generá links de cobro y recibí notificaciones automáticas cuando un cliente paga.</div>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="https://www.mercadopago.com.ar/developers/panel" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />Panel de MP
          </a>
        </Button>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <label className="text-xs font-medium block mb-1">Access Token <span className="text-muted-foreground font-normal">(privado)</span></label>
          <Input value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="APP_USR-..." type="password" autoComplete="off" />
          <div className="text-[10px] text-muted-foreground mt-1">Lo encontrás en MercadoPago Developers → Tus credenciales → Producción.</div>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Public Key</label>
          <Input value={publicKey} onChange={(e) => setPublicKey(e.target.value)} placeholder="APP_USR-..." autoComplete="off" />
        </div>
        <div className="flex items-center gap-2">
          <input id="mp-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-input" />
          <label htmlFor="mp-enabled" className="text-xs">Activar emisión de links reales (si está apagado, todos los links se generan en modo demo)</label>
        </div>
        <div className="text-[11px] text-muted-foreground rounded-md bg-muted/40 px-3 py-2 border border-border">
          <strong>Webhook:</strong> en el panel de MercadoPago configurá la URL de notificaciones a{" "}
          <code className="font-mono">https://[tu-dominio]/api/mp/webhook</code> para recibir confirmaciones automáticas de pago.
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button onClick={handleSave} disabled={save.busy}>
            {save.busy ? "Guardando…" : saved ? "Guardado ✓" : "Guardar"}
          </Button>
          {isConnected && (
            <Button variant="outline" onClick={handleDisconnect} disabled={save.busy}>Desconectar</Button>
          )}
          {save.error && <span className="text-xs text-destructive">{save.error}</span>}
        </div>
      </div>
    </div>
  )
}
