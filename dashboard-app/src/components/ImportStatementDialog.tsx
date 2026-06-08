import { useRef, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from "lucide-react"
import { api } from "@/lib/mutations"
import { cn } from "@/lib/utils"

type Mov = {
  _idx: number; _dupe: boolean; date: string; flow: string; description: string
  counterparty: string; currency: string; amount_ars: number; amount_usd: number
  category: string; expense_type: string | null; needs_review: boolean
}
type Report = { source: string; caja: string; total: number; nuevos: number; duplicados: number; revisar: number; ingresos: number; egresos: number }

const SOURCES = [
  { id: "mp", label: "Mercado Pago", hint: "Reporte “Todas las transacciones” (.xlsx)" },
  { id: "bbva", label: "Banco Francés (BBVA)", hint: "Export “Últimos movimientos” (.xlsx)" },
  { id: "bdc", label: "Banco de Comercio", hint: "Extracto de movimientos (.xlsx)" },
]
const money = (n: number) => (n ? (n < 0 ? "-$ " : "$ ") + Math.abs(Math.round(n)).toLocaleString("es-AR") : "—")

export function ImportStatementDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [source, setSource] = useState<string>("mp")
  const [filename, setFilename] = useState<string>("")
  const [movs, setMovs] = useState<Mov[] | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => { setFilename(""); setMovs(null); setReport(null); setSel(new Set()); setError(null); setDone(null) }
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
      setSel(new Set(movements.filter((m: Mov) => !m._dupe).map((m: Mov) => m._idx)))  // nuevos pre-seleccionados
    } catch (e: any) { setError(e?.message ?? String(e)); setMovs(null); setReport(null) }
    finally { setBusy(false) }
  }

  async function commit() {
    if (!movs) return
    setBusy(true); setError(null)
    try {
      const chosen = movs.filter((m) => sel.has(m._idx))
      const r = await api.importCommit(chosen)
      setDone(r.inserted); setMovs(null); setReport(null); setSel(new Set())
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
            {SOURCES.map((s) => (
              <button key={s.id} onClick={() => { setSource(s.id); reset() }}
                className={cn("text-left rounded-lg border p-3 transition", source === s.id ? "border-primary ring-1 ring-primary bg-primary/5" : "border-input hover:bg-muted/50")}>
                <div className="text-sm font-medium">{s.label}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{s.hint}</div>
              </button>
            ))}
          </div>

          {/* Paso 2: archivo */}
          <div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = "" }} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload className="h-4 w-4" />{busy && !report ? "Leyendo…" : "Elegir archivo"}
            </Button>
            {filename ? <span className="ml-2 text-xs text-muted-foreground inline-flex items-center gap-1"><FileSpreadsheet className="h-3.5 w-3.5" />{filename}</span> : null}
          </div>

          {source !== "mp" && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 p-2.5 text-[11px] text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>El formato de {SOURCES.find((s) => s.id === source)?.label} todavía no está 100% validado: todos los movimientos entran marcados <b>“a revisar”</b> para que verifiques signo y clasificación. Si algo se ve mal, mandame este archivo y afino el parser.</span>
            </div>
          )}

          {error ? <div className="text-xs text-destructive">{error}</div> : null}
          {done != null ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/20 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />Se importaron {done} movimientos al cashflow.
            </div>
          ) : null}

          {/* Paso 3: preview */}
          {report ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary">{report.caja}</Badge>
                <span className="text-muted-foreground">{report.total} en el archivo ·</span>
                <span className="text-emerald-600 font-medium">{report.nuevos} nuevos</span>
                <span className="text-muted-foreground">· {report.duplicados} ya cargados ·</span>
                <span className="text-amber-600">{report.revisar} a revisar</span>
              </div>
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
                        <tr key={m._idx} className={cn("border-t", m._dupe && "opacity-50", sel.has(m._idx) && "bg-primary/5")}>
                          <td className="p-2"><input type="checkbox" checked={sel.has(m._idx)} onChange={() => toggle(m._idx)} /></td>
                          <td className="p-2 whitespace-nowrap tabular-nums">{m.date.slice(0, 10)}</td>
                          <td className="p-2 max-w-[260px]">
                            <div className="truncate">{m.description}</div>
                            <div className="flex gap-1 mt-0.5">
                              {m._dupe ? <Badge variant="outline" className="text-[9px]">ya cargado</Badge> : null}
                              {m.needs_review && !m._dupe ? <Badge variant="outline" className="text-[9px] border-amber-400 text-amber-600">a revisar</Badge> : null}
                            </div>
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
