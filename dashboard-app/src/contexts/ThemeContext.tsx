import { createContext, useContext, useEffect, useState } from "react"

export type ThemeMode = "light" | "dark" | "system"

const STORAGE_KEY = "pacific-theme"

function readSaved(): ThemeMode {
  if (typeof localStorage === "undefined") return "system"
  const v = localStorage.getItem(STORAGE_KEY) as ThemeMode | null
  return v === "light" || v === "dark" || v === "system" ? v : "system"
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  const dark = mode === "dark" || (mode === "system" && systemPrefersDark())
  root.classList.toggle("dark", dark)
}

const Ctx = createContext<{
  mode: ThemeMode
  effectiveDark: boolean
  setMode: (m: ThemeMode) => void
} | null>(null)

export function ThemeProvider({ children, defaultMode = "system" }: { children: React.ReactNode; defaultMode?: ThemeMode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readSaved() ?? defaultMode)
  const [effectiveDark, setEffectiveDark] = useState(false)

  useEffect(() => {
    applyTheme(mode)
    setEffectiveDark(mode === "dark" || (mode === "system" && systemPrefersDark()))
    try { localStorage.setItem(STORAGE_KEY, mode) } catch {}
    if (mode === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)")
      const onChange = () => { applyTheme("system"); setEffectiveDark(mql.matches) }
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    }
  }, [mode])

  return (
    <Ctx.Provider value={{ mode, effectiveDark, setMode: setModeState }}>{children}</Ctx.Provider>
  )
}

export function useTheme() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useTheme must be used inside ThemeProvider")
  return v
}
