import { Outlet } from "react-router-dom"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/AppSidebar"
import { SiteHeader } from "@/components/SiteHeader"

export function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <SiteHeader />
        {/* min-w-0 + overflow-x-hidden: el contenido ancho (tablas) scrollea en su propio
            contenedor en vez de empujar la columna más allá del viewport en móvil */}
        <main className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6 min-w-0 overflow-x-hidden">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
