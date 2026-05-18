import { Sun, Moon, Laptop } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { useTheme } from "@/contexts/ThemeContext"

export function ModeToggle() {
  const { mode, setMode, effectiveDark } = useTheme()
  const Icon = effectiveDark ? Moon : Sun

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" aria-label="Tema">
          <Icon className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setMode("light")} className={mode === "light" ? "bg-accent" : ""}>
          <Sun className="h-4 w-4 mr-2" /> Claro
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMode("dark")} className={mode === "dark" ? "bg-accent" : ""}>
          <Moon className="h-4 w-4 mr-2" /> Oscuro
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMode("system")} className={mode === "system" ? "bg-accent" : ""}>
          <Laptop className="h-4 w-4 mr-2" /> Sistema
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
