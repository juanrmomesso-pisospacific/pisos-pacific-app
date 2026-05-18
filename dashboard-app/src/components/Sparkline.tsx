type Props = { values: number[]; width?: number; height?: number; stroke?: string; fill?: string }

export function Sparkline({ values, width = 96, height = 28, stroke = "#e4a368", fill = "rgba(228,163,104,0.18)" }: Props) {
  if (!values || values.length === 0) return <svg width={width} height={height} />
  const max = Math.max(1, ...values)
  const min = Math.min(0, ...values)
  const span = Math.max(1, max - min)
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const points = values.map((v, i) => {
    const x = i * step
    const y = height - ((v - min) / span) * (height - 2) - 1
    return [x, y] as [number, number]
  })
  const linePath = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ")
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
      <path d={areaPath} fill={fill} />
      <path d={linePath} stroke={stroke} strokeWidth={1.5} fill="none" />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={2} fill={stroke} />
    </svg>
  )
}
