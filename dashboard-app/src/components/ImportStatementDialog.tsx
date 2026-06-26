import { useEffect, useRef, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from "lucide-react"
import { api } from "@/lib/mutations"
import { cn } from "@/lib/utils"

type Mov = {
  _idx: number; _dupe: boolean; _enrich?: string; date: string; flow: string; description: string
  counterparty: string; currency: string; amount_ars: number; amount_usd: number
  category: string; expense_type: string | null; needs_review: boolean
  _maybe?: boolean; _maybe_ref?: { date: string; description: string; caja_name?: string; sale_ref?: string | null }
}
type Report = { source: string; caja: string; total: number; nuevos: number; duplicados: number; revisar: number; ingresos: number; egresos: number; actualizan?: number; posibles?: number }

const SOURCES = [
  { id: "mp-api", label: "Mercado Pago (API)", hint: "Sincronización automática — sin archivo" },
  { id: "mp", label: "Mercado Pago (archivo)", hint: "Reporte “Todas las transacciones” (.xlsx)" },
  { id: "bbva", label: "Banco Francés (BBVA)", hint: "Export “Últimos movimientos” (.xlsx)" },
  { id: "bdc", label: "Banco de Comercio", hint: "Extracto de movimientos (.xlsx)" },
]
const money = (n: number) => (n ? (n < 0 ? "-$ " : "$ ") + Math.abs(Math.round(n)).toLocaleString("es-AR") : "—")
const fmtDate = (d: string) => { const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y}` }
// el id de la tarjeta de caja → la clave que devuelve /api/import/last (mp-api comparte caja con mp)
const LAST_KEY: Record<string, string> = { "mp-api": "mp", mp: "mp", bbva: "bbva", bdc: "bdc" }
type LastInfo = Record<string, { caja: string; last: string | null; count: number }>

export function ImportStatementDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [source, setSource] = useState<string>("mp-api")
  const [days, setDays] = useState<number>(45)
  const [filename, setFilename] = useState<string>("")
  const [movs, setMovs] = useState<Mov[] | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [last, setLast] = useState<LastInfo | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // al abrir, traigo el último movimiento cargado de cada caja (para saber desde
  // qué fecha bajar el resumen y no recargar fechas ya importadas)
  useEffect(() => {
    if (!open) return
    api.importLast().then(setLast).catch(() => setLast(null))
  }, [open, done])

  const reset = () => { setFilename(""); setMovs(null); setReport(null); setSel(new Set()); setError(null); setDone(null); setSyncing(null) }
  const close = (o: boolean) => { if (!o) reset(); onOpenChange(o) }

  async function onFile(file: File) {
    setError(null); setDone(null); setBusy(true); setFilename(file.name)
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result).split(",")[1] || "")
        r.onerror = () => rej(new Error("No se pudo leer el archivo"))
        r.readAsDataURL(file)
      })
      const { movements, report } = await api.importParse(source, b64)
      setMovs(movements); setReport(report)
      setSel(new Set(movements.filter((m: Mov) => !m._dupe && !m._maybe).map((m: Mov) => m._idx)))  // nuevos pre-seleccionados
    } catch (e: any) { setError(e?.message ?? String(e)); setMovs(null); setReport(null) }
    finally { setBusy(false) }
  }

  async function mpSync() {
    setError(null); setDone(null); setBusy(true); setFilename(""); setSyncing("Creando reporte en MP…")
    try {
      const { jobId } = await api.importMpStart(days)
      // los reportes de MP tardan minutos: poll cada 8s hasta ~5 min
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      for (let i = 0; i < 40; i++) {
        await sleep(8000)
        setSyncing(`Generando reporte… (${(i + 1) * 8}s)`)
        const r = await api.importMpResult(jobId)
        if (r.ready) {
          setMovs(r.movements); setReport(r.report)
          setSel(new Set(r.movements.filter((m: Mov) => !m._dupe && !m._maybe).map((m: Mov) => m._idx)))
          setSyncing(null); setBusy(false); return
        }
      }
      setError("El reporte de MP sigue generándose. Probá de nuevo en un par de minutos.")
    } catch (e: any) { setError(e?.message ?? String(e)); setMovs(null); setReport(null) }
    finally { setSyncing(null); setBusy(false) }
  }

  async function commit() {
    if (!movs) return
    setBusy(true); setError(null)
    try {
      const chosen = movs.filter((m) => sel.has(m._idx))
      const r = await api.importCommit(chosen)
      setDone(`${r.inserted} nuevos${r.enriched ? ` · ${r.enriched} actualizados con nombre` : ""}`); setMovs(null); setReport(null); setSel(new Set())
      onDone()
    } catch (e: any) { setError(e?.message ?? String(e)) }
    finally { setBusy(false) }
  }

  const toggle = (i: number) => setSel((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  const allNew = movs?.filter((m) => !m._dupe) ?? []
  const selCount = sel.size

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="sm:max-w-2xl w-full">
        <SheetHeader>
          <SheetTitle>Importar extracto</SheetTitle>
          <SheetDescription>Subí el archivo de la caja. Se clasifican y deduplican los movimientos; revisás el preview y confirmás cuáles entran al cashflow.</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-4 overflow-y-auto max-h-[calc(100vh-180px)] pb-4 px-1">
          {/* Paso 1: caja */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {SOURCES.map((s) => {
              const li = last?.[LAST_KEY[s.id]]
              return (
              <button key={s.id} onClick={() => { setSource(s.id); reset() }}
                className={cn("text-left rounded-lg border p-3 transition", source === s.id ? "border-primary ring-1 ring-primary bg-primary/5" : "border-input hover:bg-muted/50")}>
                <div className="text-sm font-medium">{s.label}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{s.hint}</div>
                {li ? (
                  <div className="text-[10px] mt-1.5 pt-1.5 border-t border-border/60">
                    {li.last
                      ? <span className="text-emerald-600 dark:text-emerald-400">Último cargado: <b>{fmtDate(li.last)}</b></span>
                      : <span className="text-muted-foreground">Sin movimientos cargados</span>}
                    {li.count ? <span className="text-muted-foreground"> · {li.count}</span> : null}
                  </div>
                ) : null}
              </button>
            )})}
          </div>

          {last?.[LAST_KEY[source]]?.last ? (
            <div className="text-[11px] text-muted-foreground -mt-1">
              Tip: bajá el resumen <b>desde el {fmtDate(last[LAST_KEY[source]].last!)}</b> en adelante. Si se pisan fechas no pasa nada — se detectan los duplicados y posibles duplicados.
            </div>
          ) : null}

          {/* Paso 2: API (mp-api) o archivo */}
          {source === "mp-api" ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Últimos</span>
              <Input type="number" value={days} min={1} max={365} onChange={(e) => setDays(Number(e.target.value) || 45)} className="h-8 w-20" />
              <span className="text-xs text-muted-foreground">días</span>
              <Button variant="outline" size="sm" onClick={mpSync} disabled={busy}>
                <Upload className="h-4 w-4" />{syncing ? syncing : "Sincronizar con MP"}
              </Button>
            </div>
          ) : (
            <div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = "" }} />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload className="h-4 w-4" />{busy && !report ? "Leyendo…" : "Elegir archivo"}
              </Button>
              {filename ? <span className="ml-2 text-xs text-muted-foreground inline-flex items-center gap-1"><FileSpreadsheet className="h-3.5 w-3.5" />{filename}</span> : null}
            </div>
          )}

          {source === "mp-api" && (
            <div className="flex items-start gap-2 rounded-md border border-sky-300/60 bg-sky-50 dark:bg-sky-950/20 p-2.5 text-[11px] text-sky-800 dark:text-sky-300">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>La API de MP no envía nombres: los movimientos entran por monto/fecha (peajes ya clasificados) y quedan <b>“a revisar”</b>. Para ponerles nombre de una: bajá “Todas las transacciones” del panel de MP y subilo en <b>Mercado Pago (archivo)</b> — los movimientos sin nombre se actualizan solos.</span>
            </div>
          )}

          {(source === "bbva" || source === "bdc") && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 p-2.5 text-[11px] text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>El formato de {SOURCES.find((s) => s.id === source)?.label} todavía no está 100% validado: todos los movimientos entran marcados <b>“a revisar”</b> para que verifiques signo y clasificación. Si algo se ve mal, mandame este archivo y afino el parser.</span>
            </div>
          )}

          {error ? <div className="text-xs text-destructive">{error}</div> : null}
          {done != null ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/20 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />Importado: {done}.
            </div>
          ) : null}

          {/* Paso 3: preview */}
          {report ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary">{report.caja}</Badge>
                <span className="text-muted-foreground">{report.total} en el archivo ·</span>
                <span className="text-emerald-600 font-medium">{report.nuevos} nuevos</span>
                {report.actualizan ? <span className="text-sky-600 font-medium">· {report.actualizan} actualizan nombre</span> : null}
                <span className="text-muted-foreground">· {report.duplicados} ya cargados ·</span>
                <span className="text-amber-600">{report.revisar} a revisar</span>
                {report.posibles ? <span className="text-orange-600 font-medium">· {report.posibles} posibles duplicados</span> : null}
              </div>
              {report.posibles ? (
                <div className="flex items-start gap-2 rounded-md border border-orange-300/60 bg-orange-50 dark:bg-orange-950/20 p-2 text-[11px] text-orange-800 dark:text-orange-300">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span><b>{report.posibles}</b> movimiento(s) coinciden en monto y fecha (±10 días) con algo ya cargado — quizá lo cargaste a mano. Quedan <b>sin tildar</b>; revisá la fila (dice a qué se parece) y tildalos solo si querés cargarlos igual.</span>
                </div>
              ) : null}
              <div className="flex items-center gap-2 text-xs">
                <Button variant="ghost" size="sm" className="h-7" onClick={() => setSel(new Set(allNew.map((m) => m._idx)))}>Todos los nuevos</Button>
                <Button variant="ghost" size="sm" className="h-7" onClick={() => setSel(new Set(movs!.map((m) => m._idx)))}>Todos</Button>
                <Button variant="ghost" size="sm" className="h-7" onClick={() => setSel(new Set())}>Ninguno</Button>
              </div>
              <div className="rounded-md border overflow-hidden">
                <div className="max-h-[42vh] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                      <tr className="text-left text-muted-foreground">
                        <th className="p-2 w-8"></th><th className="p-2">Fecha</th><th className="p-2">Detalle</th>
                        <th className="p-2">Rubro</th><th className="p-2 text-right">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movs!.map((m) => (
                        <tr key={m._idx} className={cn("border-t", m._dupe && "opacity-50", m._maybe && !sel.has(m._idx) && "bg-orange-50/60 dark:bg-orange-950/10", sel.has(m._idx) && "bg-primary/5")}>
                          <td className="p-2"><input type="checkbox" checked={sel.has(m._idx)} onChange={() => toggle(m._idx)} /></td>
                          <td className="p-2 whitespace-nowrap tabular-nums">{m.date.slice(0, 10)}</td>
                          <td className="p-2 max-w-[260px]">
                            <div className="truncate">{m.description}</div>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {m._dupe ? <Badge variant="outline" className="text-[9px]">ya cargado</Badge> : null}
                              {m._maybe && !m._dupe ? <Badge variant="outline" className="text-[9px] border-orange-400 text-orange-600">{m._maybe_ref?.sale_ref ? "ya cobrado en venta" : "posible duplicado"}</Badge> : null}
                              {m._enrich ? <Badge variant="outline" className="text-[9px] border-sky-400 text-sky-600">actualiza nombre</Badge> : null}
                              {m.needs_review && !m._dupe ? <Badge variant="outline" className="text-[9px] border-amber-400 text-amber-600">a revisar</Badge> : null}
                            </div>
                            {m._maybe && m._maybe_ref ? (
                              <div className="text-[10px] text-orange-700/80 dark:text-orange-400/80 mt-0.5 truncate">
                                {m._maybe_ref.sale_ref
                                  ? `↔ ya registrado como cobro de la venta #${m._maybe_ref.sale_ref} — no lo cargues (sería duplicado)`
                                  : `≈ ya cargado ${m._maybe_ref.date}${m._maybe_ref.caja_name ? ` · ${m._maybe_ref.caja_name}` : ""}${m._maybe_ref.description ? ` · ${m._maybe_ref.description}` : ""}`}
                              </div>
                            ) : null}
                          </td>
                          <td className="p-2 text-muted-foreground">{m.flow === "Ingreso" ? "Ingreso" : (m.expense_type || m.category)}</td>
                          <td className={cn("p-2 text-right tabular-nums whitespace-nowrap", m.flow === "Ingreso" ? "text-emerald-600" : "")}>
                            {m.flow === "Ingreso" ? "+" : "-"}{money(m.amount_ars)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">{report ? `${selCount} seleccionados` : ""}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => close(false)}>Cerrar</Button>
            <Button size="sm" onClick={commit} disabled={busy || !report || selCount === 0}>
              {busy ? "Importando…" : `Importar ${selCount || ""}`}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
