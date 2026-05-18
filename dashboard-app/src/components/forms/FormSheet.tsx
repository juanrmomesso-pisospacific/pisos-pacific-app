import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"

export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  submitLabel = "Guardar",
  busy,
  error,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
  onSubmit: () => void | Promise<void>
  submitLabel?: string
  busy?: boolean
  error?: string | null
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="mt-6 space-y-4 overflow-y-auto max-h-[calc(100vh-200px)] pb-4">{children}</div>
        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between gap-2">
          <div className="text-xs text-destructive">{error}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button size="sm" onClick={onSubmit} disabled={busy}>{busy ? "Guardando…" : submitLabel}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-sm font-medium block mb-1">{children}</label>
}
export function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground mt-1">{children}</p>
}
