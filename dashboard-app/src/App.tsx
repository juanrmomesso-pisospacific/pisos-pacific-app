import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom"
import { ThemeProvider } from "@/contexts/ThemeContext"
import { AuthProvider, useAuth } from "@/contexts/AuthContext"
import { canAccess, landingPath } from "@/lib/access"
import { RoleProvider } from "@/contexts/RoleContext"
import { PeriodProvider } from "@/contexts/PeriodContext"
import { TopbarActionsProvider } from "@/contexts/TopbarActionsContext"
import { ConfirmProvider } from "@/components/ui/confirm"
import { Layout } from "@/components/Layout"
import DashboardPage from "@/pages/DashboardPage"
import InventarioPage from "@/pages/InventarioPage"
import GaleriaPage from "@/pages/GaleriaPage"
import CotizacionesPage from "@/pages/CotizacionesPage"
import VentasPage from "@/pages/VentasPage"
import AgendaPage from "@/pages/AgendaPage"
import ClientesPage from "@/pages/ClientesPage"
import LoginPage from "@/pages/LoginPage"
import ResetPasswordPage from "@/pages/ResetPasswordPage"
import AuditPage from "@/pages/AuditPage"
import LeadsPage from "@/pages/LeadsPage"
import MensajesPage from "@/pages/MensajesPage"
import ReportesPage from "@/pages/ReportesPage"
import ConfiguracionPage from "@/pages/ConfiguracionPage"
import CashFlowPage from "@/pages/CashFlowPage"
import CajasPage from "@/pages/CajasPage"
import ProveedoresPage from "@/pages/ProveedoresPage"

// Redirige a la página de inicio del rol (para "/" y rutas desconocidas).
function RoleLanding() {
  const { state } = useAuth()
  const role = state.status === "ready" ? state.user.role : undefined
  return <Navigate to={landingPath(role)} replace />
}
// Bloquea el acceso por URL a páginas fuera del rol (ej. logística → /cashflow → /agenda).
function AccessGuard() {
  const { state } = useAuth()
  const { pathname } = useLocation()
  const role = state.status === "ready" ? state.user.role : undefined
  if (!canAccess(role, pathname)) return <Navigate to={landingPath(role)} replace />
  return <Outlet />
}

function Gate() {
  const { state } = useAuth()
  if (state.status === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Cargando…</div>
  }
  if (state.status === "anon") {
    if (window.location.pathname === "/reset") return <ResetPasswordPage />
    return <LoginPage />
  }
  return (
    <RoleProvider>
      <PeriodProvider>
        <TopbarActionsProvider>
         <ConfirmProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<RoleLanding />} />
                <Route element={<AccessGuard />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/mensajes" element={<MensajesPage />} />
                  <Route path="/leads" element={<LeadsPage />} />
                  <Route path="/inventario" element={<InventarioPage />} />
                  <Route path="/galeria" element={<GaleriaPage />} />
                  <Route path="/cotizaciones" element={<CotizacionesPage />} />
                  <Route path="/ventas" element={<VentasPage />} />
                  <Route path="/agenda" element={<AgendaPage />} />
                  <Route path="/gastos" element={<Navigate to="/cashflow" replace />} />
                  <Route path="/cashflow" element={<CashFlowPage />} />
                  <Route path="/cajas" element={<CajasPage />} />
                  <Route path="/clientes" element={<ClientesPage />} />
                  <Route path="/proveedores" element={<ProveedoresPage />} />
                  <Route path="/movimientos" element={<AuditPage />} />
                  <Route path="/reportes" element={<ReportesPage />} />
                  <Route path="/configuracion" element={<ConfiguracionPage />} />
                </Route>
                <Route path="*" element={<RoleLanding />} />
              </Route>
            </Routes>
          </BrowserRouter>
         </ConfirmProvider>
        </TopbarActionsProvider>
      </PeriodProvider>
    </RoleProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ThemeProvider>
  )
}
