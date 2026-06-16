// Descarga de CSV en el navegador. Excel-friendly: BOM UTF-8 (acentos OK) + CRLF.
type Cell = string | number | null | undefined

function csvCell(v: Cell): string {
  const s = v == null ? "" : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCSV(filename: string, headers: string[], rows: Cell[][]) {
  const csv = "\uFEFF" + [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
