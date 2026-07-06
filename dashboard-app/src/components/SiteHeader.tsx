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
  "/cashflow": "Gastos y Pagos",
  "/cajas": "Cajas",
  "/proveedores": "Proveedores",
  "/galeria": "Galería",
  "/clientes": "Clientes",
  "/movimientos": "Movimientos de stock",
  "/reportes": "Reportes",
  "/configuracion": "Configuración",
  "/configuracion/integraciones": "Integraciones",
}

// Which routes should show the global period selector?
const PERIOD_ROUTES = new Set(["/dashboard", "/reportes", "/cashflow"])
// Which routes get the dashboard-only threshold settings panel?
const DASHBOARD_ROUTES = new Set(["/dashboard"])

export function SiteHeader() {
  const { pathname } = useLocation()
  const title = TITLES[pathname] ?? "Pisos Pacific"
  const showPeriod = PERIOD_ROUTES.has(pathname)
  const isDashboard = DASHBOARD_ROUTES.has(pathname)
  return (
    <header className="sticky top-0 z-30 flex min-h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/95 py-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))] backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-[width,height] ease-linear lg:py-0 lg:pt-[env(safe-area-inset-top)]" style={{ ["--header-height" as any]: "3.5rem" }}>
      {/* flex-wrap: en móvil, si las acciones no entran junto al título, bajan a una 2da línea
          (en vez de desbordar). En desktop entra todo en una sola fila. */}
      <div className="flex w-full flex-wrap items-center gap-2 px-4 lg:flex-nowrap lg:px-6">
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
