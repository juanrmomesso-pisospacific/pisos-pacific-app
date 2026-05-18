import { User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { useRole } from "@/contexts/RoleContext"
import { useApi } from "@/lib/api"

type SettingsResp = { sellers?: { name: string; phone?: string }[] }

export function RoleSwitcher() {
  const { role, setRole, locked } = useRole()
  const { data } = useApi<SettingsResp>("/api/settings")
  const sellers = data?.sellers ?? []
  // Vendors can't switch role — they're locked to their own scope.
  if (locked) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <User className="h-3.5 w-3.5" />
          <span>{role.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Ver como</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setRole({ kind: "admin", label: "Admin" })} className={role.kind === "admin" ? "bg-accent" : ""}>
          Admin
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Vendedores</DropdownMenuLabel>
        {sellers.map((s) => {
          const active = role.kind === "vendor" && role.sellerName === s.name
          const short = s.name.split(" ")[0]
          return (
            <DropdownMenuItem
              key={s.name}
              onClick={() => setRole({ kind: "vendor", label: short, sellerName: s.name, phone: s.phone })}
              className={active ? "bg-accent" : ""}
            >
              {s.name}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
