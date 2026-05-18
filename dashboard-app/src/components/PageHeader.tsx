import { cn } from "@/lib/utils"

export function PageHeader({ title, description, actions, className }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("px-4 lg:px-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div>
        <h1 className="serif text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground mt-0.5">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
