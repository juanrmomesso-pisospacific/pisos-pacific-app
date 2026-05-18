import { useLocation } from "react-router-dom"
import { Separator } from "@/components/ui/separator"
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage } from "@/components/ui/breadcrumb"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { PeriodSelector } from "@/components/PeriodSelector"
import { RoleSwitcher } from "@/components/RoleSwitcher"
import { ThresholdSettings } from "@/components/ThresholdSettings"
import { ModeToggle } from "@/components/ModeToggle"
import { TopbarActionsSlot } from "@/contexts/TopbarActionsContext"

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/mensajes": "Mensajes",
  "/leads": "Leads",
  "/inventario": "Inventario",
  "/cotizaciones": "Cotizaciones",
  "/ventas": "Ventas",
  "/agenda": "Agenda",
  "/gastos": "Gastos y Pagos",
  "/clientes": "Clientes",
  "/movimientos": "Movimientos de stock",
  "/reportes": "Reportes",
  "/configuracion": "Configuración",
  "/configuracion/integraciones": "Integraciones",
}

// Which routes should show the global period selector?
const PERIOD_ROUTES = new Set(["/dashboard", "/reportes"])
// Which routes get the dashboard-only threshold settings panel?
const DASHBOARD_ROUTES = new Set(["/dashboard"])

export function SiteHeader() {
  const { pathname } = useLocation()
  const title = TITLES[pathname] ?? "Pisos Pacific"
  const showPeriod = PERIOD_ROUTES.has(pathname)
  const isDashboard = DASHBOARD_ROUTES.has(pathname)
  return (
    <header className="sticky top-0 z-30 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)" style={{ ["--header-height" as any]: "3.5rem" }}>
      <div className="flex w-full items-center gap-2 px-4 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {showPeriod && <PeriodSelector />}
          <TopbarActionsSlot />
          <RoleSwitcher />
          {isDashboard && <ThresholdSettings />}
          <ModeToggle />
        </div>
      </div>
    </header>
  )
}
