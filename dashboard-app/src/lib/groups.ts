import type { Product } from "@/lib/types"

export type GroupId = "Pisos H2O" | "Pisos de Madera" | "Otros"

export const GROUP_ORDER: GroupId[] = ["Pisos H2O", "Pisos de Madera", "Otros"]

export const GROUP_COLOR: Record<GroupId, string> = {
  "Pisos H2O": "#7ed1c1",
  "Pisos de Madera": "#e4a368",
  "Otros": "#9a9a9a",
}

export function groupForCategory(cat: string | undefined | null): GroupId {
  if (cat === "Pisos H2O") return "Pisos H2O"
  if (cat === "Pisos de Madera") return "Pisos de Madera"
  return "Otros"
}

export function groupForProduct(p: Product | undefined): GroupId {
  if (!p) return "Otros"
  return groupForCategory(p.category)
}
