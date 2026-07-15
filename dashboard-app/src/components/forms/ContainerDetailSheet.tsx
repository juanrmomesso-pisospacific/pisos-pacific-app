import { useRef, useState } from "react"
import { Ship, FileText, Upload, PackageCheck, CheckCircle2, AlertTriangle } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useConfirm } from "@/components/ui/confirm"
import { api, refresh } from "@/lib/mutations"
import { fmtInt, appLocale } from "@/lib/utils"
import { fileToBase64 } from "@/lib/export"
import type { Container } from "@/lib/types"

const STATUS_LABEL: Record<string, string> = { in_transit: "En tránsito", arrived: "Arribado", received: "Nacionalizado" }
const DOC_LABEL: Record<string, string> = { invoice: "Invoice", packing: "Packing", other: "Doc" }

export function ContainerDetailSheet({ container, onClose }: { container: Container | null; onClose: () => void }) {
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ credited: any[]; skipped: any[] } | null>(null)

  if (!container) return null
  const c = container
  const items = Array.isArray(c.items) ? c.items : []
  const docs = Array.isArray(c.documents) ? c.documents : []
  const totalM2 = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)
  const received = c.status === "received"

  const close = () => { setResult(null); onClose() }

  async function nationalize() {
    const ok = await confirm({
      title: "Nacionalizar y cargar inventario",
      description: `Se van a acreditar ${fmtInt(totalM2)} m² (${items.length} ítems) al stock. Esta acción no se puede deshacer.`,
      confirmLabel: "Sí, cargar inventario",
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await api.containerReceive(c.id)
      setResult({ credited: r?.credited ?? [], skipped: r?.skipped ?? [] })
      refresh()
    } catch (e: any) {
      setResult({ credited: [], skipped: [{ description: "Error: " + String(e?.message || e), quantity: 0 }] })
    } finally { setBusy(false) }
  }

  async function addDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (e.currentTarget) e.currentTarget.value = ""
    if (!f) return
    setBusy(true)
    try {
      const b64 = await fileToBase64(f)
      await api.containerAddDocument(c.id, { data_base64: b64, filename: f.name, content_type: f.type, kind: /invoice|factura|proforma/i.test(f.name) ? "invoice" : /packing/i.test(f.name) ? "packing" : "other" })
      refresh()
    } catch { /* best-effort */ } finally { setBusy(false) }
  }

  return (
    <Sheet open={!!container} onOpenChange={(o) => !o && close()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Ship className="h-4 w-4 text-blue-600" />{c.id} · {c.vessel}</SheetTitle>
          <SheetDescription>
            {c.supplier} · {STATUS_LABEL[c.status] ?? c.status}{c.eta ? ` · ETA ${c.eta.slice(0, 10)}` : ""}
            {received && c.received_at ? ` · cargado ${new Date(c.received_at).toLocaleDateString(appLocale())}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          {/* Resultado de la carga */}
          {result && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm space-y-1">
              <div className="flex items-center gap-2 font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />Inventario cargado</div>
              <div className="text-xs">{result.credited.length} producto(s) acreditados al stock.</div>
              {result.skipped.length > 0 && (
                <div className="text-xs text-amber-700 flex items-start gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{result.skipped.length} ítem(s) NO se cargaron (sin producto asociado): {result.skipped.map((s) => s.description || s.sku).filter(Boolean).join(", ")}</span>
                </div>
              )}
            </div>
          )}

          {/* Documentos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Documentos</div>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => fileRef.current?.click()} disabled={busy}><Upload className="h-3.5 w-3.5 mr-1" />Subir</Button>
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv" className="hidden" onChange={addDoc} />
            </div>
            {docs.length === 0 ? (
              <div className="text-xs text-muted-foreground">Sin documentos adjuntos.</div>
            ) : (
              <div className="space-y-1">
                {docs.map((d) => (
                  <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm hover:bg-muted/40">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{d.filename}</span>
                    <Badge variant="muted" className="text-[10px]">{DOC_LABEL[d.kind] ?? d.kind}</Badge>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Ítems */}
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Ítems ({items.length} · {fmtInt(totalM2)} m²)</div>
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Lote</TableHead>
                    <TableHead className="text-right">m²</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs max-w-[220px] truncate">{it.description || it.sku}</TableCell>
                      <TableCell className="text-xs">{it.lot || "—"}</TableCell>
                      <TableCell className="text-right tabular text-xs">{fmtInt(it.quantity)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Acción nacionalizar */}
          {received ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2">
              <PackageCheck className="h-4 w-4" />Inventario ya cargado{c.received_at ? ` el ${new Date(c.received_at).toLocaleDateString(appLocale())}` : ""}.
            </div>
          ) : (
            <Button className="w-full" onClick={nationalize} disabled={busy || items.length === 0}>
              <PackageCheck className="h-4 w-4 mr-1" />Nacionalizado → cargar inventario
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
