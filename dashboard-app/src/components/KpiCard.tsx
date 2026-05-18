import { Card, CardHeader, CardTitle, CardDescription, CardFooter, CardAction } from "@/components/ui/card"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { ChevronRight, ArrowUp, ArrowDown, Minus, Info } from "lucide-react"

export type Delta = { pct: number; isUp: boolean } | null

function DeltaBadge({ delta }: { delta: Delta }) {
  if (delta == null) return null
  const Icon = delta.pct > 0.001 ? ArrowUp : delta.pct < -0.001 ? ArrowDown : Minus
  return (
    <Badge variant="outline" className="gap-1 text-xs">
      <Icon className="h-3 w-3" />
      {Math.abs(delta.pct * 100).toFixed(1)}%
    </Badge>
  )
}

type Props = {
  label: string
  icon: React.ComponentType<{ className?: string }>
  value: React.ReactNode
  delta?: Delta
  deltaSublabel?: string
  footer?: React.ReactNode
  sparkline?: React.ReactNode
  drawerTitle?: string
  drawerDescription?: string
  drawerContent?: React.ReactNode
  tooltip?: string
}

export function KpiCard({ label, icon: Icon, value, delta, deltaSublabel, footer, sparkline, drawerTitle, drawerDescription, drawerContent, tooltip }: Props) {
  const card = (
    <Card className="@container/card group cursor-pointer transition-colors gap-0 shadow-none bg-gradient-to-t from-primary/5 to-card hover:from-primary/10">
      <CardHeader className="pb-2 gap-1">
        <CardDescription className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-medium">
          <Icon className="h-3.5 w-3.5" />
          <span className="truncate">{label}</span>
          {tooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); e.preventDefault() }}
                  className="text-muted-foreground/60 hover:text-foreground transition-colors"
                  aria-label="Información"
                >
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
          ) : null}
        </CardDescription>
        <CardTitle className="serif text-2xl @[180px]/card:text-3xl font-semibold tabular leading-tight tracking-tight">
          {value}
        </CardTitle>
        {(delta || drawerContent) && (
          <CardAction>
            <div className="flex items-center gap-1">
              <DeltaBadge delta={delta ?? null} />
              {drawerContent ? <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" /> : null}
            </div>
          </CardAction>
        )}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm pt-0 pb-5 px-5">
        {sparkline ? <div className="mb-1 -ml-1">{sparkline}</div> : null}
        <div className="text-xs text-muted-foreground line-clamp-2">
          {deltaSublabel ? <span className="mr-1">{deltaSublabel}</span> : null}
          {footer}
        </div>
      </CardFooter>
    </Card>
  )

  if (!drawerContent) return card

  return (
    <Sheet>
      <SheetTrigger asChild>{card}</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{drawerTitle ?? label}</SheetTitle>
          {drawerDescription ? <SheetDescription>{drawerDescription}</SheetDescription> : null}
        </SheetHeader>
        <div className="mt-6 overflow-y-auto max-h-[calc(100vh-160px)]">{drawerContent}</div>
      </SheetContent>
    </Sheet>
  )
}
