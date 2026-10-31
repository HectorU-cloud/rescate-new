import { eq } from "drizzle-orm";
import { financeSettings } from "@db/schema";
import { DEFAULT_SERVICE_FEE } from "@contracts/pricing";
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
