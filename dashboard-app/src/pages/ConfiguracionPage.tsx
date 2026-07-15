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
import { useConfirm } from "@/components/ui/confirm"
import { ROLE_LABEL } from "@/lib/access"
import { useModules, moduleOn } from "@/contexts/ConfigContext"
import { KeyRound, Trash2 } from "lucide-react"

type MpSettings = { enabled: boolean; access_token: string; public_key: string }
type Seller = { name: string; phone?: string }
type Settings = {
  integrations?: { mercadopago?: MpSettings }
  company?: { name?: string; web?: string; email?: string; warranty?: string; fx_note?: string }
  tax?: { rate?: number; label?: string }
  currency?: { local?: string; fx_provider?: string; fx_rate?: number }
  locale?: string
  sellers?: Seller[]
  modules?: Record<string, boolean>
}

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
  const finanzasOn = moduleOn(useModules(), "finanzas")

  return (
    <div className="px-4 lg:px-6 space-y-4 md:space-y-6 max-w-3xl">
      {isAdmin && settings && <OperationSection settings={settings} />}
      {finanzasOn && (
        <Card>
          <CardHeader>
            <CardTitle>Integraciones</CardTitle>
            <CardDescription>Conectá Pacific con los servicios externos que usan el día a día.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MercadoPagoSection mp={settings?.integrations?.mercadopago} />
          </CardContent>
        </Card>
      )}
      {isAdmin && <UsersManager />}
      <TemplateManager />
      {finanzasOn && <RulesManager />}
      {isAdmin && <EmailCleanupSection />}
    </div>
  )
}

// Configuración de la operación (multi-país): empresa (marca en PDF/mails), impuesto de las
// ventas, vendedores y módulos activos. El socio de cada instancia la edita desde acá —
// pedido del dueño (15/7): impuestos y vendedores cargables desde la app, sin tocar código.
const MODULE_META: { key: string; label: string; desc: string }[] = [
  { key: "finanzas", label: "Finanzas (CashFlow)", desc: "Libro diario, cajas, extractos, conciliación. Apagado: los cobros se registran directo en la venta." },
  { key: "dashboard_finanzas", label: "Dashboard financiero", desc: "Gastos y resultado neto en el Dashboard (requiere Finanzas)." },
  { key: "contenedores", label: "Contenedores", desc: "Importaciones que acreditan inventario al nacionalizar." },
  { key: "agenda", label: "Agenda", desc: "Calendario de colocaciones, equipos y tareas." },
  { key: "galeria", label: "Galería", desc: "Banco de imágenes (Google Drive)." },
  { key: "reportes", label: "Reportes", desc: "Reportes avanzados." },
]
function OperationSection({ settings }: { settings: Settings }) {
  const [company, setCompany] = useState({ name: "", web: "", email: "", ...settings.company })
  const [taxLabel, setTaxLabel] = useState(settings.tax?.label ?? "IVA 21%")
  const [taxPct, setTaxPct] = useState(Math.round(((settings.tax?.rate ?? 0.21) * 100) * 100) / 100)
  const [curLocal, setCurLocal] = useState(settings.currency?.local ?? "ARS")
  const [fxProvider, setFxProvider] = useState(settings.currency?.fx_provider ?? "blue")
  const [locale, setLocale] = useState(settings.locale ?? "es-AR")
  const [sellers, setSellers] = useState<Seller[]>(settings.sellers ?? [])
  const [modules, setModules] = useState<Record<string, boolean>>({ ...settings.modules })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const confirm = useConfirm()

  const setSeller = (i: number, patch: Partial<Seller>) => setSellers(prev => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const save = async () => {
    if (modules.finanzas === false && settings.modules?.finanzas !== false) {
      const ok = await confirm({
        title: "¿Apagar el módulo Finanzas?",
        description: "CashFlow, Cajas y Proveedores desaparecen de la navegación y los cobros pasan a registrarse directo en la venta. Los datos NO se borran: al reactivarlo vuelve todo.",
        confirmLabel: "Apagar Finanzas",
      })
      if (!ok) return
    }
    setSaving(true); setMsg(null)
    try {
      await patchSettings({
        company,
        tax: { label: taxLabel, rate: Math.max(0, Number(taxPct) || 0) / 100 },
        currency: { local: curLocal.trim().toUpperCase() || "ARS", fx_provider: fxProvider, fx_rate: 1 },
        locale: locale.trim() || "es-AR",
        sellers: sellers.filter(s => s.name.trim()),
        modules,
      } as Partial<Settings>)
      setMsg("Guardado ✓")
      refresh()
    } catch (e: any) { setMsg(`Error al guardar (${e?.message || e})`) }
    finally { setSaving(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operación</CardTitle>
        <CardDescription>Empresa, impuesto, vendedores y módulos de esta instancia. Cada país/operación tiene su propia configuración.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="text-sm font-medium mb-2">Empresa (aparece en presupuestos y mails)</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Nombre</span>
              <Input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Web</span>
              <Input value={company.web} onChange={(e) => setCompany({ ...company, web: e.target.value })} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Email</span>
              <Input value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} /></label>
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-2">Impuesto de las ventas</div>
          <div className="grid grid-cols-2 gap-2 max-w-sm">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Etiqueta (ej. IVA 21% / ITBMS 7%)</span>
              <Input value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Tasa (%)</span>
              <Input type="number" min={0} max={100} step="0.5" value={taxPct} onChange={(e) => setTaxPct(Number(e.target.value))} /></label>
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-2">País y moneda</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Moneda local</span>
              <Input value={curLocal} onChange={(e) => setCurLocal(e.target.value)} placeholder="ARS / USD" /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Tipo de cambio a USD</span>
              <select value={fxProvider} onChange={(e) => setFxProvider(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                <option value="blue">Dólar blue (Argentina)</option>
                <option value="fixed">Fijo 1:1 (moneda local = USD)</option>
              </select></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Formato regional (locale)</span>
              <Input value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="es-AR / es-PA" /></label>
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-2">Vendedores (selector de cotizaciones/ventas y bot de tareas)</div>
          <div className="space-y-1.5">
            {sellers.map((s, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input value={s.name} placeholder="Nombre" onChange={(e) => setSeller(i, { name: e.target.value })} className="flex-1" />
                <Input value={s.phone ?? ""} placeholder="Teléfono (+507 …)" onChange={(e) => setSeller(i, { phone: e.target.value })} className="w-44" />
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" title="Quitar" onClick={() => setSellers(prev => prev.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setSellers(prev => [...prev, { name: "", phone: "" }])}>+ Agregar vendedor</Button>
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-1">Módulos activos</div>
          <div className="text-[11px] text-muted-foreground mb-2">El núcleo (Inventario, Cotizaciones, Ventas, Clientes, Mensajes y Leads) está siempre activo.</div>
          <div className="space-y-1.5">
            {MODULE_META.map((m) => (
              <label key={m.key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={modules[m.key] !== false} onChange={(e) => setModules(prev => ({ ...prev, [m.key]: e.target.checked }))} />
                <span><b className="font-medium">{m.label}</b> <span className="text-muted-foreground text-xs">— {m.desc}</span></span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

// Gestión de usuarios / equipo (solo admin): crear cuentas con rol, cambiar contraseña, eliminar.
type TeamUser = { id: string; email: string; name: string; role: string; seller_name: string }
const ROLE_OPTIONS = ["logistica", "vendor", "admin"] as const
function UsersManager() {
  const usersApi = useApi<TeamUser[]>("/api/users")
  const users = usersApi.data ?? []
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<string>("logistica")
  const [seller, setSeller] = useState("")
  const [pw, setPw] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const confirm = useConfirm()

  const create = async () => {
    setBusy(true); setError(null); setOk(null)
    try {
      const r = await fetch("/api/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role, seller_name: role === "vendor" ? seller : "", password: pw }),
      })
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || `${r.status}`)
      setOk(`Usuario ${j.user.email} creado como ${ROLE_LABEL[role]}.`)
      setName(""); setEmail(""); setSeller(""); setPw(""); setRole("logistica")
      usersApi.refetch()
    } catch (e: any) { setError(e?.message || "error") } finally { setBusy(false) }
  }
  const del = async (u: TeamUser) => {
    if (!(await confirm({ title: "Eliminar usuario", description: `Se elimina el acceso de ${u.name} (${u.email}). Sus sesiones se cierran.`, confirmLabel: "Eliminar", destructive: true }))) return
    const r = await fetch(`/api/users/${u.id}`, { method: "DELETE" })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) { setError(j.error || "no se pudo borrar"); return }
    setError(null); usersApi.refetch()
  }
  const resetPw = async (u: TeamUser) => {
    const npw = window.prompt(`Nueva contraseña para ${u.name} (mínimo 6 caracteres):`)
    if (!npw) return
    const r = await fetch(`/api/users/${u.id}/set-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: npw }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) setError(j.error || "error"); else { setError(null); setOk(`Contraseña de ${u.name} actualizada.`) }
  }
  const canSubmit = name.trim() && /.+@.+\..+/.test(email) && pw.length >= 6

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usuarios del equipo</CardTitle>
        <CardDescription>
          Creá accesos con distintos permisos. <b>Logística / Entregas</b> solo ve Ventas, Cotizaciones, Leads,
          Mensajes y Agenda (no Dashboard, Inventario ni Administración). <b>Vendedor</b> ve su propio scope.
          <b> Administrador</b> ve todo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <div className="text-sm text-destructive flex items-center gap-1.5"><AlertCircle className="h-4 w-4" />{error}</div>}
        {ok && <div className="text-sm text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />{ok}</div>}

        {/* Usuarios existentes */}
        <div className="rounded-md border border-border divide-y divide-border">
          {users.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">Sin usuarios.</div>}
          {users.map((u) => (
            <div key={u.id} className="px-3 py-2 flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{u.name} <span className="text-muted-foreground font-normal">· {u.email}</span></div>
                <div className="text-[11px] text-muted-foreground">{ROLE_LABEL[u.role] ?? u.role}{u.seller_name ? ` · ${u.seller_name}` : ""}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Cambiar contraseña" onClick={() => resetPw(u)}><KeyRound className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Eliminar" onClick={() => del(u)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>

        {/* Alta de usuario */}
        <div className="rounded-md border border-border p-3 space-y-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nuevo usuario</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-xs font-medium block mb-1">Nombre</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellido" /></div>
            <div><label className="text-xs font-medium block mb-1">Email</label><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="persona@pisospacific.com" type="email" autoComplete="off" /></div>
            <div>
              <label className="text-xs font-medium block mb-1">Rol</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
            {role === "vendor" && <div><label className="text-xs font-medium block mb-1">Nombre de vendedor <span className="text-muted-foreground font-normal">(para su scope)</span></label><Input value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="Como figura en las ventas" /></div>}
          </div>
          <div><label className="text-xs font-medium block mb-1">Contraseña inicial</label><Input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="mínimo 6 caracteres" type="text" autoComplete="off" /></div>
          <Button onClick={create} disabled={busy || !canSubmit}>{busy ? "Creando…" : "Crear usuario"}</Button>
        </div>
      </CardContent>
    </Card>
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
