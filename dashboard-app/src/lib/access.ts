// Control de acceso por rol (navegación + rutas). Un rol restringido solo ve ciertas páginas;
// admin y vendor no tienen restricción de navegación acá (el backend gatea las escrituras
// sensibles con requireAdmin). El rol "logistica" coordina entregas/colocaciones: ve Ventas,
// Cotizaciones, Leads, Mensajes y Agenda, y NADA más.

export type Role = "admin" | "vendor" | "logistica"

export const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  vendor: "Vendedor",
  logistica: "Logística / Entregas",
}

// Rutas permitidas por rol RESTRINGIDO. Un rol que no está acá = acceso total (admin, vendor).
const RESTRICTED_PATHS: Record<string, string[]> = {
  logistica: ["/ventas", "/cotizaciones", "/leads", "/mensajes", "/agenda"],
}
// A dónde cae el usuario tras login / en rutas desconocidas.
const LANDING: Record<string, string> = {
  logistica: "/agenda",
}

/** Lista de rutas permitidas, o null si el rol no tiene restricción. */
export function allowedPaths(role?: string): string[] | null {
  return (role && RESTRICTED_PATHS[role]) || null
}
/** ¿El rol puede entrar a esta ruta? */
export function canAccess(role: string | undefined, path: string): boolean {
  const allow = allowedPaths(role)
  if (!allow) return true
  return allow.some((p) => path === p || path.startsWith(p + "/"))
}
/** Página de inicio del rol (para "/" y rutas no permitidas). */
export function landingPath(role?: string): string {
  return (role && LANDING[role]) || "/dashboard"
}
