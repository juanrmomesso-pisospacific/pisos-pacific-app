import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { ThemeProvider } from "@/contexts/ThemeContext"
import { AuthProvider, useAuth } from "@/contexts/AuthContext"
import { RoleProvider } from "@/contexts/RoleContext"
import { PeriodProvider } from "@/contexts/PeriodContext"
import { TopbarActionsProvider } from "@/contexts/TopbarActionsContext"
import { Layout } from "@/components/Layout"
import DashboardPage from "@/pages/DashboardPage"
import InventarioPage from "@/pages/InventarioPage"
import CotizacionesPage from "@/pages/CotizacionesPage"
import VentasPage from "@/pages/VentasPage"
import AgendaPage from "@/pages/AgendaPage"
import GastosPage from "@/pages/GastosPage"
import ClientesPage from "@/pages/ClientesPage"
import LoginPage from "@/pages/LoginPage"
import AuditPage from "@/pages/AuditPage"
import LeadsPage from "@/pages/LeadsPage"
import MensajesPage from "@/pages/MensajesPage"
import ReportesPage from "@/pages/ReportesPage"
import ConfiguracionPage from "@/pages/ConfiguracionPage"
import CashFlowPage from "@/pages/CashFlowPage"
import CajasPage from "@/pages/CajasPage"
import ProveedoresPage from "@/pages/ProveedoresPage"

function Gate() {
  const { state } = useAuth()
  if (state.status === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Cargando…</div>
  }
  if (state.status === "anon") return <LoginPage />
  return (
    <RoleProvider>
      <PeriodProvider>
        <TopbarActionsProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/mensajes" element={<MensajesPage />} />
                <Route path="/leads" element={<LeadsPage />} />
                <Route path="/inventario" element={<InventarioPage />} />
                <Route path="/cotizaciones" element={<CotizacionesPage />} />
                <Route path="/ventas" element={<VentasPage />} />
                <Route path="/agenda" element={<AgendaPage />} />
                <Route path="/gastos" element={<GastosPage />} />
                <Route path="/cashflow" element={<CashFlowPage />} />
                <Route path="/cajas" element={<CajasPage />} />
                <Route path="/clientes" element={<ClientesPage />} />
                <Route path="/proveedores" element={<ProveedoresPage />} />
                <Route path="/movimientos" element={<AuditPage />} />
                <Route path="/reportes" element={<ReportesPage />} />
                <Route path="/configuracion" element={<ConfiguracionPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
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
