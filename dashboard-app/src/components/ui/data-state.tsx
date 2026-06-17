import { AlertCircle } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"

// Muestra skeleton mientras carga y una tarjeta con "Reintentar" si falla — para que
// el arranque/cold-start no se vea como "sin datos" (riesgo en una app con plata).
// Solo intercepta cuando NO hay datos todavía: si ya hubo datos, el polling no parpadea.
export function DataState({
  loading, error, hasData, onRetry, children,
}: {
  loading: boolean
  error: Error | null
  hasData: boolean
  onRetry?: () => void
  children: React.ReactNode
}) {
  if (error && !hasData) {
    return (
      <div className="px-4 lg:px-6 py-8">
        <div className="mx-auto max-w-sm rounded-lg border border-border bg-card p-6 text-center">
          <AlertCircle className="mx-auto mb-2 h-5 w-5 text-destructive" />
          <div className="text-sm text-muted-foreground">{error.message || "No se pudieron cargar los datos."}</div>
          {onRetry && <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Reintentar</Button>}
        </div>
      </div>
    )
  }
  if (loading && !hasData) {
    return (
      <div className="px-4 lg:px-6 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    )
  }
  return <>{children}</>
}
