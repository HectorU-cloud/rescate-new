import type { OrderStatusKey } from "@contracts/constants";

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return "ahora mismo";
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** ¿Pasaron como máximo `minutes` minutos desde `date`? */
export function withinMinutes(date: Date | string | null | undefined, minutes: number): boolean {
  if (!date) return false;
  const d = typeof date === "string" ? new Date(date) : date;
  return Date.now() - d.getTime() <= minutes * 60_000;
}

export function statusIndex(flow: OrderStatusKey[], status: string): number {
  if (status === "cancelled") return -1;
  return flow.indexOf(status as OrderStatusKey);
}

export const CATEGORY_LABELS: Record<string, string> = {
  "comida-rapida": "Comida rápida",
  mariscos: "Mariscos",
  panaderia: "Panadería",
  cafeteria: "Cafetería",
  supermercado: "Supermercado",
  bebidas: "Bebidas y jugos",
};
