import { useEffect, useMemo, useRef, useState } from "react"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"

export type PickerItem = {
  id: string
  label: string
  sub?: string
  hint?: string          // small right-aligned note (e.g. price or stock)
  keywords?: string      // extra text to match against
}

/**
 * Type-to-filter picker. Shows a dropdown of matches as you type; click to select.
 * Optionally offers a "create new" row when the query has no exact match.
 */
export function SearchPicker({
  items, placeholder, onPick, onCreate, createLabel, autoFocus,
}: {
  items: PickerItem[]
  placeholder?: string
  onPick: (id: string) => void
  onCreate?: (text: string) => void
  createLabel?: (text: string) => string
  autoFocus?: boolean
}) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  // Normaliza para comparar sin importar mayúsculas/acentos/espacios → evita ofrecer
  // "Crear" cuando ya existe (ej: "ferreteria" vs "Ferretería") y así no duplicar.
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim()

  const filtered = useMemo(() => {
    const needle = norm(q)
    if (!needle) return items.slice(0, 40)
    const terms = needle.split(/\s+/)
    return items
      .filter((it) => {
        const hay = norm(`${it.label} ${it.sub ?? ""} ${it.keywords ?? ""}`)
        return terms.every((t) => hay.includes(t))
      })
      .slice(0, 40)
  }, [items, q])

  const exact = items.some((it) => norm(it.label) === norm(q))
  const showCreate = !!onCreate && q.trim().length > 1 && !exact

  function pick(id: string) { onPick(id); setQ(""); setOpen(false); setActive(0) }
  function create() { onCreate?.(q.trim()); setQ(""); setOpen(false); setActive(0) }

  function onKey(e: React.KeyboardEvent) {
    const n = filtered.length + (showCreate ? 1 : 0)
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(n - 1, a + 1)); setOpen(true) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === "Enter") {
      e.preventDefault()
      if (active < filtered.length) pick(filtered[active].id)
      else if (showCreate) create()
    } else if (e.key === "Escape") setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {open && (filtered.length > 0 || showCreate) && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {filtered.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(it.id)}
              className={cn("w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm", i === active ? "bg-accent" : "")}
            >
              <span className="min-w-0">
                <span className="block truncate">{it.label}</span>
                {it.sub ? <span className="block text-[11px] text-muted-foreground truncate">{it.sub}</span> : null}
              </span>
              {it.hint ? <span className="text-xs text-muted-foreground tabular shrink-0">{it.hint}</span> : null}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onMouseEnter={() => setActive(filtered.length)}
              onClick={create}
              className={cn("w-full text-left px-3 py-2 text-sm border-t border-border", active === filtered.length ? "bg-accent" : "")}
            >
              {createLabel ? createLabel(q.trim()) : `Crear "${q.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
