// Descarga de CSV en el navegador. Excel-friendly: BOM UTF-8 (acentos OK) + CRLF.
type Cell = string | number | null | undefined

function csvCell(v: Cell): string {
  const s = v == null ? "" : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Parser CSV chico (tolera BOM, comillas, comas y saltos dentro de comillas). Devuelve
// una lista de objetos {header: valor} usando la primera fila como encabezados.
export function parseCSV(text: string): Record<string, string>[] {
  const s = text.replace(/^﻿/, "")
  const rows: string[][] = []
  let row: string[] = [], field = "", inQ = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ",") { row.push(field); field = "" }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = "" }
    else if (c === "\r") { /* ignore */ }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  const clean = rows.filter(r => r.some(c => c.trim() !== ""))
  if (!clean.length) return []
  const headers = clean[0].map(h => h.trim())
  return clean.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])))
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
