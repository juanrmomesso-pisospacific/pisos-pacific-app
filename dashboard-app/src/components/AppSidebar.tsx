import { LayoutGrid, Package, FileText, TrendingUp, Calendar, Users, Settings, History, Sparkles, MessageSquare, BarChart3, ArrowRightLeft, Wallet, Truck } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton, SidebarRail
} from "@/components/ui/sidebar"
import { NavUser } from "@/components/NavUser"
import { useTheme } from "@/contexts/ThemeContext"

type NavItem = { label: string; href: string; icon: React.ComponentType<{ className?: string }>; sub?: { label: string; href: string; icon: React.ComponentType<{ className?: string }> }[] }

const NAV_OPERACION: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutGrid },
  { label: "Mensajes", href: "/mensajes", icon: MessageSquare },
  { label: "Leads", href: "/leads", icon: Sparkles },
  { label: "Cotizaciones", href: "/cotizaciones", icon: FileText },
  { label: "Ventas", href: "/ventas", icon: TrendingUp },
  { label: "Agenda", href: "/agenda", icon: Calendar },
  { label: "Inventario", href: "/inventario", icon: Package },
]
const NAV_ADMIN: NavItem[] = [
  { label: "CashFlow / Gastos", href: "/cashflow", icon: ArrowRightLeft },
  { label: "Cajas", href: "/cajas", icon: Wallet },
  { label: "Clientes", href: "/clientes", icon: Users },
  { label: "Proveedores", href: "/proveedores", icon: Truck },
]
const NAV_SISTEMA: NavItem[] = [
  { label: "Reportes", href: "/reportes", icon: BarChart3 },
  { label: "Movimientos", href: "/movimientos", icon: History },
  { label: "Configuración", href: "/configuracion", icon: Settings },
]

function isActive(href: string, pathname: string) {
  if (href === "/dashboard") return pathname === "/dashboard"
  return pathname.startsWith(href)
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const { pathname } = useLocation()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active = isActive(item.href, pathname)
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                  <Link to={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
                {item.sub && active ? (
                  <SidebarMenuSub>
                    {item.sub.map((s) => (
                      <SidebarMenuSubItem key={s.href}>
                        <SidebarMenuSubButton asChild isActive={pathname === s.href}>
                          <Link to={s.href}>
                            <s.icon />
                            <span>{s.label}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                ) : null}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar() {
  const { effectiveDark } = useTheme()
  const fullLogo = effectiveDark ? "/LogoPacific.png" : "/LogoPacificDark.png"
  const smallLogo = effectiveDark ? "/LogoPacificSmall.png" : "/LogoPacificSmallDark.png"
  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader>
        <Link to="/dashboard" className="flex items-center justify-center px-2 py-2">
          <img src={fullLogo} alt="Pisos Pacific" className="max-w-[150px] h-auto group-data-[collapsible=icon]:hidden" />
          <img src={smallLogo} alt="Pisos Pacific" className="h-7 w-auto hidden group-data-[collapsible=icon]:block" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Operación" items={NAV_OPERACION} />
        <NavGroup label="Administración" items={NAV_ADMIN} />
        <NavGroup label="Sistema" items={NAV_SISTEMA} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <NavUser />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
