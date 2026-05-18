import * as React from "react"
import * as RechartsPrimitive from "recharts"
import { cn } from "@/lib/utils"

export type ChartConfig = Record<string, { label?: React.ReactNode; icon?: React.ComponentType; color?: string }>

type ChartContextProps = { config: ChartConfig }
const ChartContext = React.createContext<ChartContextProps | null>(null)

export function useChart() {
  const ctx = React.useContext(ChartContext)
  if (!ctx) throw new Error("useChart must be used inside <ChartContainer/>")
  return ctx
}

export const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    config: ChartConfig
    children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"]
  }
>(({ id, className, children, config, ...props }, ref) => {
  const uniqueId = React.useId()
  const chartId = `chart-${(id ?? uniqueId).replace(/:/g, "")}`
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        ref={ref}
        className={cn("flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none", className)}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
})
ChartContainer.displayName = "ChartContainer"

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([_, cfg]) => cfg.color)
  if (!colorConfig.length) return null
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}] { ${colorConfig.map(([key, cfg]) => `--color-${key}: ${cfg.color};`).join(" ")} }`,
      }}
    />
  )
}

export const ChartTooltip = RechartsPrimitive.Tooltip

export const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    active?: boolean
    payload?: any[]
    label?: any
    hideLabel?: boolean
    hideIndicator?: boolean
    indicator?: "line" | "dot"
    labelFormatter?: (label: any, payload: any[]) => React.ReactNode
    formatter?: (value: any, name: string, item: any) => React.ReactNode
    nameKey?: string
    labelKey?: string
  }
>(({ active, payload, label, className, hideLabel = false, hideIndicator = false, indicator = "dot", labelFormatter, formatter, nameKey }, ref) => {
  const { config } = useChart()
  if (!active || !payload?.length) return null
  const labelNode = !hideLabel ? (labelFormatter ? labelFormatter(label, payload) : label) : null
  return (
    <div ref={ref} className={cn("grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-popover px-2.5 py-1.5 text-xs shadow-xl", className)}>
      {labelNode ? <div className="font-medium text-foreground">{labelNode}</div> : null}
      <div className="grid gap-1.5">
        {payload.map((item, i) => {
          const key = `${nameKey || item.dataKey || item.name || "value"}`
          const itemConfig = config[key as keyof typeof config] ?? config[item.dataKey as keyof typeof config]
          const color = itemConfig?.color ?? item.payload?.fill ?? item.color
          return (
            <div key={i} className="flex w-full flex-wrap items-stretch gap-2 [&>svg]:size-2.5 [&>svg]:text-muted-foreground">
              {!hideIndicator && (
                indicator === "dot"
                  ? <span className="shrink-0 rounded-[2px] h-2.5 w-2.5 mt-0.5" style={{ background: color }} />
                  : <span className="shrink-0 w-1 mt-0.5 self-stretch" style={{ background: color }} />
              )}
              <div className="flex flex-1 justify-between leading-none items-center">
                <span className="text-muted-foreground">{itemConfig?.label ?? item.name}</span>
                <span className="font-mono font-medium tabular-nums text-foreground">{formatter ? formatter(item.value, item.name, item) : item.value}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
ChartTooltipContent.displayName = "ChartTooltipContent"
