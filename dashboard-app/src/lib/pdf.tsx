import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer"
import { appLocale } from "@/lib/utils"

// Pacific PDF engine (server-side, pdf/pacific_pdf.py) — opens the rendered presupuesto.
export function openPacificPdf(kind: "quotes" | "sales", id: string) {
  window.open(`/api/${kind}/${id}/pdf`, "_blank")
}

// Built-in Helvetica — no external fetch, always available.

// Brand tokens
const INK   = "#000000"
const TEXT  = "#1a1a1a"
const MUTED = "#555555"
const FAINT = "#888888"
const RULE  = "#cccccc"
const PACIFIC      = "#e4a368"
const PACIFIC_DARK = "#a8662f"

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 28, paddingHorizontal: 32, fontSize: 9, fontFamily: "Helvetica", color: TEXT },

  // Top header (date + seller left, brand right)
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  topLeftCol: { flexDirection: "column", gap: 1 },
  topLine: { fontSize: 9, color: TEXT },
  topLabel: { fontSize: 9, color: TEXT },
  brandCol: { alignItems: "flex-end" },
  brandMark: { fontSize: 22, fontWeight: 700, letterSpacing: 3, color: INK },
  brandMarkAccent: { color: PACIFIC, fontSize: 22, fontWeight: 700, letterSpacing: 3 },
  brandTag: { fontSize: 7, color: MUTED, letterSpacing: 1.5, marginTop: 4, textTransform: "uppercase" },
  brandRule: { height: 1, width: 130, backgroundColor: INK, marginTop: 2 },

  // Title bar (bordered box)
  titleBox: { borderWidth: 1, borderColor: INK, paddingVertical: 8, marginBottom: 12, alignItems: "center" },
  titleText: { fontSize: 11, fontWeight: 700, color: INK },

  // Client box
  clientBox: { borderWidth: 1, borderColor: INK, padding: 10, marginBottom: 14 },
  clientLine: { fontSize: 9, color: TEXT, marginBottom: 2 },
  clientBold: { fontWeight: 700 },

  // Items table — bordered grid
  table: { borderWidth: 1, borderColor: INK },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK },
  th2: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK },
  td: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE },
  cellDesc: { flex: 1, padding: 6, borderRightWidth: 0.5, borderRightColor: RULE },
  cellUnidad: { width: "16%", padding: 6, textAlign: "center", borderRightWidth: 0.5, borderRightColor: RULE },
  cellPrecio: { width: "20%", padding: 6, textAlign: "right", borderRightWidth: 0.5, borderRightColor: RULE },
  cellTotal:  { width: "20%", padding: 6, textAlign: "right" },
  thText:  { fontSize: 9, fontWeight: 700, color: INK, textTransform: "uppercase" },
  thSub:   { fontSize: 8, color: MUTED, textTransform: "uppercase" },

  // Bottom section — 3-row × 2-col grid, rows align horizontally between left (terms) and right (totals)
  bottomGrid: { marginTop: 14, borderWidth: 1, borderColor: INK },
  bottomGridRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE, minHeight: 26 },
  bottomGridRowLast: { flexDirection: "row", minHeight: 30 },
  bottomLeftCell: { flex: 1, padding: 6, borderRightWidth: 0.5, borderRightColor: RULE, justifyContent: "center" },
  bottomRightLabel: { width: "18%", padding: 6, borderRightWidth: 0.5, borderRightColor: RULE, justifyContent: "center" },
  bottomRightValue: { width: "22%", padding: 6, justifyContent: "center", alignItems: "flex-end" },
  termsTitleLine: { fontSize: 9, fontWeight: 700, color: INK },
  termsCenter: { fontSize: 9, fontWeight: 700, color: INK, textAlign: "center" },
  termsItalic: { fontSize: 8, color: MUTED, fontStyle: "italic", marginBottom: 2, lineHeight: 1.5 },
  totalsLabel: { fontSize: 9, fontWeight: 700, color: INK },
  totalsLabelMuted: { fontSize: 9, color: MUTED },
  totalsValue: { fontSize: 10, fontWeight: 700, color: INK, textAlign: "right" },
  totalsValueAccent: { fontSize: 10, fontWeight: 700, color: PACIFIC_DARK, fontStyle: "italic", textAlign: "right" },
  totalsGrand: { fontSize: 13, fontWeight: 700, color: INK, textAlign: "right" },

  // Footer
  footer: { position: "absolute", bottom: 14, left: 32, right: 32, fontSize: 7, color: FAINT, textAlign: "center" },
})

const fmtNum = (n: number, decimals = 2) => (n || 0).toLocaleString(appLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
const fmtUsd = (n: number) => "US$" + fmtNum(n)
const fmtQty = (n: number) => (n || 0).toLocaleString(appLocale(), { maximumFractionDigits: 2 })

type DocItem = { sku?: string; description: string; quantity: number; unit_price: number; unit?: string }
export type DocData = {
  kind: "Cotización" | "Venta"
  number: string
  date: string
  renewedDate?: string  // when set, vigencia is computed from this and the date label switches to "Renovada el X"
  client: { name: string; dni?: string; address?: string; email?: string; phone?: string }
  seller?: string
  sellerPhone?: string
  items: DocItem[]
  hasIva: boolean
  notes?: string
  validDays?: number
  paymentTerms?: { anticipo: number; conforme: number }  // % values
  discount?: { kind: "pct" | "amount"; value: number; amount: number }
}

export function BusinessDoc({ d }: { d: DocData }) {
  const subtotal = d.items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const discountAmt = d.discount?.amount ?? 0
  const subAfterDisc = Math.max(0, subtotal - discountAmt)
  const iva = d.hasIva ? subAfterDisc * 0.21 : 0
  const total = subAfterDisc + iva
  const docTitle = d.kind === "Cotización" ? `PRESUPUESTO PRELIMINAR - ${d.number}` : `COMPROBANTE DE VENTA - ${d.number}`
  const validDays = d.validDays ?? 10
  const issued = new Date(d.renewedDate ?? d.date)
  const isRenewed = !!d.renewedDate
  const pay = d.paymentTerms ?? { anticipo: 80, conforme: 20 }

  return (
    <Document title={`${d.kind} ${d.number} — Pisos Pacific`} author="Pisos Pacific">
      <Page size="A4" style={s.page}>
        {/* Top row — date/seller left, brand right */}
        <View style={s.topRow}>
          <View style={s.topLeftCol}>
            <Text style={s.topLine}>{isRenewed ? "Renovada: " : "Fecha: "}{issued.toLocaleDateString(appLocale(), { day: "numeric", month: "numeric", year: "numeric" })}</Text>
            <Text style={s.topLabel}>Contacto de Venta:</Text>
            <Text style={s.topLine}>{[d.seller, d.sellerPhone].filter(Boolean).join(" ")}</Text>
          </View>
          <View style={s.brandCol}>
            <Text>
              <Text style={s.brandMarkAccent}>(( </Text>
              <Text style={s.brandMark}>PACIFIC</Text>
            </Text>
            <View style={s.brandRule} />
            <Text style={s.brandTag}>La evolución del piso de madera</Text>
          </View>
        </View>

        {/* Title bar */}
        <View style={s.titleBox}>
          <Text style={s.titleText}>{docTitle}</Text>
        </View>

        {/* Client + observaciones */}
        <View style={s.clientBox}>
          <Text style={s.clientLine}><Text style={s.clientBold}>Cliente: </Text>{d.client.name}</Text>
          {d.client.address ? <Text style={s.clientLine}>Dirección: {d.client.address}</Text> : null}
          {d.client.dni     ? <Text style={s.clientLine}>DNI/CUIT: {d.client.dni}</Text> : null}
          {d.client.phone   ? <Text style={s.clientLine}>Teléfono: {d.client.phone}</Text> : null}
          {d.client.email   ? <Text style={s.clientLine}>Email: {d.client.email}</Text> : null}
          <Text style={[s.clientLine, { marginTop: 6 }]}>Observaciones: {d.notes ?? ""}</Text>
        </View>

        {/* Items table */}
        <View style={s.table}>
          <View style={s.th}>
            <Text style={[s.cellDesc, s.thText]}>DESCRIPCION</Text>
            <Text style={[s.cellUnidad, s.thText]}>UNIDAD</Text>
            <Text style={[s.cellPrecio, s.thText]}>PRECIO</Text>
            <Text style={[s.cellTotal, s.thText]}>TOTAL</Text>
          </View>
          <View style={s.th2}>
            <Text style={[s.cellDesc, s.thSub]}>SKU</Text>
            <Text style={[s.cellUnidad, s.thSub]}>M2</Text>
            <Text style={[s.cellPrecio, s.thSub]}>USD</Text>
            <Text style={[s.cellTotal, s.thSub]}>USD</Text>
          </View>
          {d.items.map((it, i) => (
            <View key={i} style={s.td}>
              <Text style={s.cellDesc}>{it.description}{it.sku ? `` : ""}</Text>
              <Text style={s.cellUnidad}>{fmtQty(it.quantity)}</Text>
              <Text style={s.cellPrecio}>{fmtUsd(it.unit_price)}</Text>
              <Text style={s.cellTotal}>{fmtUsd(it.quantity * it.unit_price)}</Text>
            </View>
          ))}
        </View>

        {/* Bottom — 3 rows × 2 cols, left/right aligned */}
        <View style={s.bottomGrid}>
          {/* Row 1: FORMA DE PAGO | PRECIO TOTAL */}
          <View style={s.bottomGridRow}>
            <View style={s.bottomLeftCell}>
              <Text style={s.termsTitleLine}>FORMA DE PAGO   ANTICIPO {pay.anticipo}%   CONFORME {pay.conforme}%</Text>
            </View>
            <View style={s.bottomRightLabel}><Text style={s.totalsLabel}>SUBTOTAL</Text></View>
            <View style={s.bottomRightValue}><Text style={s.totalsValue}>{fmtUsd(subtotal)}</Text></View>
          </View>
          {/* Optional discount row */}
          {discountAmt > 0 && (
            <View style={s.bottomGridRow}>
              <View style={s.bottomLeftCell}>{/* spacer — keeps row aligned */}</View>
              <View style={s.bottomRightLabel}><Text style={s.totalsLabelMuted}>{d.discount!.kind === "pct" ? `DESCUENTO ${d.discount!.value}%` : "DESCUENTO"}</Text></View>
              <View style={s.bottomRightValue}><Text style={[s.totalsValue, { color: PACIFIC_DARK }]}>−{fmtUsd(discountAmt)}</Text></View>
            </View>
          )}
          {/* Row 2: CONDICIONES COMERCIALES | IVA */}
          <View style={s.bottomGridRow}>
            <View style={s.bottomLeftCell}>
              <Text style={s.termsCenter}>CONDICIONES COMERCIALES</Text>
            </View>
            <View style={s.bottomRightLabel}><Text style={s.totalsLabelMuted}>IVA</Text></View>
            <View style={s.bottomRightValue}><Text style={s.totalsValueAccent}>{fmtUsd(iva)}</Text></View>
          </View>
          {/* Row 3: terms italic | TOTAL */}
          <View style={s.bottomGridRowLast}>
            <View style={s.bottomLeftCell}>
              <Text style={s.termsItalic}>La garantía es válida si la instalación es realizada por Pisos Pacific</Text>
              <Text style={s.termsItalic}>Valores en dólar billete promedio dos puntas</Text>
              <Text style={s.termsItalic}>Vigencia del presupuesto {validDays} días</Text>
            </View>
            <View style={s.bottomRightLabel}><Text style={s.totalsLabel}>TOTAL</Text></View>
            <View style={s.bottomRightValue}><Text style={s.totalsGrand}>{fmtUsd(total)}</Text></View>
          </View>
        </View>

        {/* Footer */}
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `pisospacific.com  ·  info@pisospacific.com  ·  @pisospacific          ${pageNumber} / ${totalPages}`} />
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
    a.download = `${d.kind === "Cotización" ? "Presupuesto" : "Venta"}-${d.number}.pdf`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e: any) {
    console.error("PDF generation failed:", e)
    alert(`No se pudo generar el PDF: ${e?.message ?? e}`)
    throw e
  }
}

/** Generate a Blob without auto-downloading — useful for previews / share flows. */
export async function buildBusinessDocBlob(d: DocData): Promise<Blob> {
  return await pdf(<BusinessDoc d={d} />).toBlob()
}

/** Helper to convert a Quote row into the DocData shape, including the discount. */
export function quoteToDocData(quote: {
  quote_number: string; created_at: string; renewed_at?: string;
  client_name: string; client_dni?: string; client_address?: string; client_email?: string; client_phone?: string;
  seller_name?: string; seller_phone?: string;
  items?: { sku?: string; description: string; quantity: number; unit_price: number }[];
  has_iva?: boolean; internal_notes?: string;
  valid_days?: number;
  discount_kind?: "pct" | "amount"; discount_value?: number; discount_amount?: number;
}): DocData {
  return {
    kind: "Cotización",
    number: quote.quote_number,
    date: quote.created_at,
    renewedDate: quote.renewed_at,
    client: { name: quote.client_name, dni: quote.client_dni, address: quote.client_address, email: quote.client_email, phone: quote.client_phone },
    seller: quote.seller_name,
    sellerPhone: quote.seller_phone,
    items: quote.items?.map(it => ({ sku: it.sku, description: it.description, quantity: it.quantity, unit_price: it.unit_price })) ?? [],
    hasIva: !!quote.has_iva,
    notes: quote.internal_notes,
    validDays: quote.valid_days,
    discount: (quote.discount_amount && quote.discount_amount > 0)
      ? { kind: quote.discount_kind ?? "amount", value: quote.discount_value ?? 0, amount: quote.discount_amount }
      : undefined,
  }
}
