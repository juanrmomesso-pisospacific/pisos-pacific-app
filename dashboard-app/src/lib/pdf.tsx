import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer"
// PDF body uses React-PDF's built-in Helvetica — clean, reliable, no external font fetch.

// Pacific brand tokens (kept in sync with /src/index.css)
const PACIFIC      = "#e4a368"
const PACIFIC_DARK = "#b87c4a"
const INK          = "#18181b"
const MUTED        = "#71717a"
const SUBTLE       = "#a1a1aa"
const HAIR         = "#e4e4e7"
const SOFT         = "#f5f5f5"

const s = StyleSheet.create({
  page: { paddingTop: 0, paddingBottom: 56, paddingHorizontal: 40, fontSize: 9, fontFamily: "Helvetica", color: INK },

  // Top accent stripe — full-bleed copper band
  stripe: { height: 8, backgroundColor: PACIFIC, marginHorizontal: -40 },

  // Header (wordmark left, doc meta right)
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingTop: 32, marginBottom: 8 },
  brandWordmark: { fontSize: 28, fontWeight: 700, letterSpacing: 4, color: INK },
  brandSub: { fontSize: 7.5, color: MUTED, marginTop: 6, letterSpacing: 1.4 },
  meta: { textAlign: "right" },
  metaLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1.2 },
  metaNumber: { fontSize: 22, fontWeight: 700, marginTop: 4, letterSpacing: -0.5, color: INK },
  metaDate: { fontSize: 9, color: MUTED, marginTop: 6 },
  metaValid: { fontSize: 8, color: PACIFIC_DARK, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 },

  // Section labels (small uppercase eyebrow text)
  hairline: { height: 1, backgroundColor: HAIR, marginVertical: 14 },
  sectionLabel: { fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 4 },
  twoCol: { flexDirection: "row", gap: 24, marginTop: 4 },
  col: { flex: 1 },
  clientName: { fontWeight: 600, fontSize: 12, color: INK },
  clientDetail: { fontSize: 9, color: MUTED, marginTop: 2, lineHeight: 1.4 },

  // Items table
  table: { marginTop: 16 },
  th: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1.5, borderBottomColor: INK },
  td: { flexDirection: "row", paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: HAIR },
  cellSku:  { width: "14%", paddingHorizontal: 4, fontSize: 8, color: SUBTLE },
  cellDesc: { flex: 1, paddingHorizontal: 4 },
  cellQty:  { width: "10%", paddingHorizontal: 4, textAlign: "right" },
  cellPrice:{ width: "16%", paddingHorizontal: 4, textAlign: "right" },
  cellTotal:{ width: "18%", paddingHorizontal: 4, textAlign: "right", fontWeight: 600 },
  thText: { fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 600 },
  itemDesc: { fontSize: 9.5, fontWeight: 500, color: INK },

  // Totals
  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 18 },
  totals: { width: 240 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  totalLabel: { color: MUTED, fontSize: 9 },
  totalValue: { fontSize: 9 },
  grandWrap: { marginTop: 6, backgroundColor: SOFT, padding: 10, borderLeftWidth: 3, borderLeftColor: PACIFIC },
  grandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  grandLabel: { fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  grandValue: { fontWeight: 700, fontSize: 16, color: INK, letterSpacing: -0.4 },

  // Terms / notes
  terms: { marginTop: 30, padding: 12, backgroundColor: SOFT, borderLeftWidth: 2, borderLeftColor: HAIR, fontSize: 8, color: MUTED, lineHeight: 1.6 },
  termsLabel: { fontSize: 7, color: PACIFIC_DARK, textTransform: "uppercase", letterSpacing: 1.4, fontWeight: 700, marginBottom: 4 },

  // Footer
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: HAIR },
  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerBrand: { fontSize: 8, fontWeight: 700, letterSpacing: 1.5, color: INK },
  footerMeta: { fontSize: 7, color: SUBTLE },
})

const fmtMoney = (n: number) => "$ " + (n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmtQty   = (n: number) => (n || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })

type DocItem = { sku?: string; description: string; quantity: number; unit_price: number }
export type DocData = {
  kind: "Cotización" | "Venta"
  number: string
  date: string
  client: { name: string; dni?: string; address?: string; email?: string; phone?: string }
  seller?: string
  items: DocItem[]
  hasIva: boolean
  notes?: string
  validDays?: number  // for cotizaciones, default 7
}

export function BusinessDoc({ d }: { d: DocData }) {
  const subtotal = d.items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const iva = d.hasIva ? subtotal * 0.21 : 0
  const total = subtotal + iva
  const docTitle = d.kind === "Cotización" ? "Cotización" : "Comprobante de venta"
  const validDays = d.validDays ?? 7
  const issued = new Date(d.date)
  const validUntil = new Date(issued.getTime() + validDays * 86400000)

  return (
    <Document title={`${docTitle} ${d.number} — Pisos Pacific`} author="Pisos Pacific">
      <Page size="A4" style={s.page}>
        {/* Copper accent stripe — full bleed, top of every page */}
        <View style={s.stripe} fixed />

        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.brandWordmark}>PACIFIC</Text>
            <Text style={s.brandSub}>PISOS DE MADERA  ·  H₂O  ·  PREMIUM</Text>
          </View>
          <View style={s.meta}>
            <Text style={s.metaLabel}>{docTitle}</Text>
            <Text style={s.metaNumber}>#{d.number}</Text>
            <Text style={s.metaDate}>
              Emitida {issued.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}
            </Text>
            {d.kind === "Cotización" && (
              <Text style={s.metaValid}>Válida hasta {validUntil.toLocaleDateString("es-AR", { day: "numeric", month: "short" })}</Text>
            )}
          </View>
        </View>

        <View style={s.hairline} />

        {/* Client + seller */}
        <View style={s.twoCol}>
          <View style={s.col}>
            <Text style={s.sectionLabel}>Cliente</Text>
            <Text style={s.clientName}>{d.client.name}</Text>
            {d.client.dni     ? <Text style={s.clientDetail}>DNI/CUIT: {d.client.dni}</Text> : null}
            {d.client.address ? <Text style={s.clientDetail}>{d.client.address}</Text> : null}
            {d.client.email   ? <Text style={s.clientDetail}>{d.client.email}</Text> : null}
            {d.client.phone   ? <Text style={s.clientDetail}>{d.client.phone}</Text> : null}
          </View>
          {d.seller && (
            <View style={s.col}>
              <Text style={s.sectionLabel}>Vendedor</Text>
              <Text style={s.clientName}>{d.seller}</Text>
            </View>
          )}
        </View>

        {/* Items */}
        <View style={s.table}>
          <View style={s.th}>
            <Text style={[s.cellSku, s.thText]}>SKU</Text>
            <Text style={[s.cellDesc, s.thText]}>Descripción</Text>
            <Text style={[s.cellQty, s.thText]}>Cant.</Text>
            <Text style={[s.cellPrice, s.thText]}>P. Unit.</Text>
            <Text style={[s.cellTotal, s.thText]}>Total</Text>
          </View>
          {d.items.map((it, i) => (
            <View key={i} style={s.td}>
              <Text style={s.cellSku}>{it.sku ?? "—"}</Text>
              <View style={s.cellDesc}><Text style={s.itemDesc}>{it.description}</Text></View>
              <Text style={s.cellQty}>{fmtQty(it.quantity)}</Text>
              <Text style={s.cellPrice}>{fmtMoney(it.unit_price)}</Text>
              <Text style={s.cellTotal}>{fmtMoney(it.quantity * it.unit_price)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={s.totalsWrap}>
          <View style={s.totals}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Subtotal</Text>
              <Text style={s.totalValue}>{fmtMoney(subtotal)}</Text>
            </View>
            {d.hasIva && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>IVA (21%)</Text>
                <Text style={s.totalValue}>{fmtMoney(iva)}</Text>
              </View>
            )}
            <View style={s.grandWrap}>
              <View style={s.grandRow}>
                <Text style={s.grandLabel}>Total</Text>
                <Text style={s.grandValue}>{fmtMoney(total)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Terms / notes */}
        <View style={s.terms}>
          <Text style={s.termsLabel}>{d.kind === "Cotización" ? "Términos" : "Aviso"}</Text>
          <Text>
            {d.kind === "Cotización"
              ? `Cotización válida por ${validDays} días desde su emisión. Los precios están sujetos a disponibilidad de stock y variaciones del tipo de cambio. La aceptación implica conformidad con los presentes términos.`
              : "Comprobante interno. Documento no fiscal. La factura electrónica correspondiente se emite por separado al concretar la operación."}
          </Text>
          {d.notes ? <Text style={{ marginTop: 6, fontStyle: "italic" }}>{d.notes}</Text> : null}
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <View style={s.footerRow}>
            <Text style={s.footerBrand}>PACIFIC</Text>
            <Text style={s.footerMeta}>pisospacific.com · info@pisospacific.com · @pisospacific</Text>
            <Text style={s.footerMeta} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
          </View>
        </View>
      </Page>
    </Document>
  )
}

export async function downloadBusinessDoc(d: DocData) {
  try {
    const blob = await pdf(<BusinessDoc d={d} />).toBlob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${d.kind === "Cotización" ? "Cotizacion" : "Venta"}-${d.number}.pdf`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e: any) {
    console.error("PDF generation failed:", e)
    alert(`No se pudo generar el PDF: ${e?.message ?? e}`)
    throw e
  }
}

/** Generate a Blob without auto-downloading — useful for share flows. */
export async function buildBusinessDocBlob(d: DocData): Promise<Blob> {
  return await pdf(<BusinessDoc d={d} />).toBlob()
}
