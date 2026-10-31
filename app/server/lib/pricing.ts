import { and, count, eq, gte, inArray, isNull } from "drizzle-orm";
import { financeSettings, orders, users } from "@db/schema";
import { DEFAULT_SERVICE_FEE, simulateDynamicPricing } from "@contracts/pricing";
import { getDb } from "../queries/connection";
import type { DeliveryPricing } from "./business-rules";

/**
 * Tarifas vigentes que configuró el admin. Si todavía no guardó la configuración (no existe la fila), la tarifa de
 * servicio usa el valor de lanzamiento y el envío usa las tarifas de cada local, sin topes (como antes).
 */
export async function loadPricingConfig(): Promise<{ serviceFee: number; pricing: DeliveryPricing | undefined }> {
  const [row] = await getDb().select().from(financeSettings).where(eq(financeSettings.id, 1)).limit(1);
  if (!row) return { serviceFee: DEFAULT_SERVICE_FEE, pricing: undefined };
  return {
    serviceFee: Number(row.serviceFee),
    pricing: {
      baseFee: Number(row.deliveryBaseFee),
      perKm: Number(row.deliveryPerKm),
      perMinute: Number(row.deliveryPerMinute),
      minFee: Number(row.minDeliveryFee),
      maxFee: Number(row.maxDeliveryFee),
    },
  };
}

/** Ventana de pedidos sin repartidor que cuenta como demanda actual (los más viejos ya se cancelan solos). */
const DEMAND_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Demanda del momento: pedidos a domicilio todavía sin repartidor y repartidores aprobados y disponibles.
 * Solo alimenta la simulación; si falla devuelve null y el pedido se crea igual.
 */
export async function loadDemandSignal(): Promise<{ openOrders: number; availableCouriers: number } | null> {
  try {
    const db = getDb();
    const [open] = await db.select({ n: count() }).from(orders).where(and(
      eq(orders.type, "delivery"), eq(orders.fulfillmentMethod, "delivery"), isNull(orders.courierId),
      inArray(orders.status, ["pending", "accepted", "preparing", "ready"]),
      gte(orders.createdAt, new Date(Date.now() - DEMAND_WINDOW_MS)),
    ));
    const [couriers] = await db.select({ n: count() }).from(users).where(and(
      eq(users.appRole, "courier"), eq(users.courierApproved, true), eq(users.courierAvailable, true),
    ));
    return { openOrders: Number(open?.n ?? 0), availableCouriers: Number(couriers?.n ?? 0) };
  } catch (error) {
    console.error("No se pudo medir la demanda para la simulación de precio:", error);
    return null;
  }
}

/** Arma la simulación de un envío. Nunca lanza: una simulación fallida no debe impedir un pedido. */
export async function simulateDeliveryPricing(quote: { fee: number; maxFee?: number; estimatedMinutes: number; routeProvider?: "google" | "fallback"; staticMinutes?: number }) {
  try {
    const demand = await loadDemandSignal();
    return simulateDynamicPricing({
      deliveryFee: quote.fee,
      maxFee: quote.maxFee ?? null,
      // Con tráfico vs sin tráfico solo es comparable si la ruta vino de Google.
      trafficMinutes: quote.routeProvider === "google" ? quote.estimatedMinutes : null,
      staticMinutes: quote.routeProvider === "google" ? quote.staticMinutes ?? null : null,
      openOrders: demand?.openOrders ?? null,
      availableCouriers: demand?.availableCouriers ?? null,
      weather: null, // pendiente: proveedor de clima con caché por zona
    });
  } catch (error) {
    console.error("No se pudo calcular la simulación de precio dinámico:", error);
    return null;
  }
}
