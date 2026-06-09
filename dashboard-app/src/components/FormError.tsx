export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">{children}</div>
}
