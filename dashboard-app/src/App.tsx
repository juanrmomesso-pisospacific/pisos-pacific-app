import { lazy, Suspense } from "react"
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom"
import { ThemeProvider } from "@/contexts/ThemeContext"
import { AuthProvider, useAuth } from "@/contexts/AuthContext"
import { canAccess, landingPath } from "@/lib/access"
import { RoleProvider } from "@/contexts/RoleContext"
import { PeriodProvider } from "@/contexts/PeriodContext"
import { TopbarActionsProvider } from "@/contexts/TopbarActionsContext"
import { ConfirmProvider } from "@/components/ui/confirm"
import { Layout } from "@/components/Layout"
import LoginPage from "@/pages/LoginPage"
import ResetPasswordPage from "@/pages/ResetPasswordPage"
// Code-splitting por página: el bundle único pasaba los 2.9 MB; cada página carga su chunk.
const DashboardPage = lazy(() => import("@/pages/DashboardPage"))
const InventarioPage = lazy(() => import("@/pages/InventarioPage"))
const GaleriaPage = lazy(() => import("@/pages/GaleriaPage"))
const CotizacionesPage = lazy(() => import("@/pages/CotizacionesPage"))
const VentasPage = lazy(() => import("@/pages/VentasPage"))
const AgendaPage = lazy(() => import("@/pages/AgendaPage"))
const ClientesPage = lazy(() => import("@/pages/ClientesPage"))
const AuditPage = lazy(() => import("@/pages/AuditPage"))
const LeadsPage = lazy(() => import("@/pages/LeadsPage"))
const MensajesPage = lazy(() => import("@/pages/MensajesPage"))
const ReportesPage = lazy(() => import("@/pages/ReportesPage"))
const ConfiguracionPage = lazy(() => import("@/pages/ConfiguracionPage"))
const CashFlowPage = lazy(() => import("@/pages/CashFlowPage"))
const CajasPage = lazy(() => import("@/pages/CajasPage"))
const ProveedoresPage = lazy(() => import("@/pages/ProveedoresPage"))

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
            <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Cargando…</div>}>
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
            </Suspense>
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
