# Precio dinámico — modo simulación

## Qué hace
En cada pedido **a domicilio** el servidor calcula, además del envío normal, qué multiplicador se habría sugerido según tráfico y demanda, y lo guarda en `orders.deliveryPricing.dynamicSimulation`. **No se cobra nada de eso**: el total del pedido sigue siendo subtotal + envío normal + tarifa de servicio. El campo `charged` queda siempre en `false`.

La simulación corre siempre (no depende del interruptor "Habilitar precios dinámicos", que queda reservado para la activación real más adelante). Si falla (por ejemplo, no se puede medir la demanda), el pedido se crea igual y simplemente no lleva simulación.

## Señales
| Señal | Cómo se mide | Recargo sugerido |
|---|---|---|
| Tráfico | minutos con tráfico ÷ minutos sin tráfico (Google Routes, `duration` / `staticDuration`). Sin Google no hay medición y no suma | ≥1,15 → +5 %; ≥1,30 → +10 %; ≥1,50 → +20 % |
| Demanda | pedidos a domicilio sin repartidor (últimas 3 h) ÷ repartidores aprobados y disponibles | ≥1 → +5 %; ≥2 → +15 %; ≥3 → +30 % |
| Clima | **Pendiente**: la función ya lo acepta (`clear`, `light_rain`, `heavy_rain`) pero hoy llega vacío | 0 / +5 % / +15 % |

Se aplica el tramo más alto alcanzado en cada señal, se suman y el multiplicador **nunca pasa de ×1,5**. Además, el envío sugerido no supera el **envío máximo** configurado por el admin. Si falta una señal, esa señal no suma (nunca se sugiere más por falta de datos).

Los umbrales están en `DYNAMIC_SIMULATION_RULES` (`contracts/pricing.ts`). Si los cambias, sube `DYNAMIC_SIMULATION_VERSION`. `PRICING_FORMULA_VERSION` no cambió porque el envío cobrado se calcula igual que antes.

## Dónde verlo
Finanzas → **Precio dinámico (simulación)**: pedidos simulados, porcentaje con recargo sugerido, multiplicador medio, ingreso extra hipotético, señales activas y una comparación de tiempos reales (desde que el repartidor aceptó hasta la entrega) entre pedidos con y sin recargo sugerido. Sirve para comprobar si las señales de verdad predicen entregas más lentas. Con pocas entregas por grupo (menos de ~20) el panel avisa que no hay base para concluir.

## Cuándo pasar al siguiente paso
No actives cobro real hasta tener varias semanas de datos y confirmar que (1) los pedidos con recargo sugerido realmente tardan más o les falta repartidor, (2) el ingreso extra hipotético justifica la complejidad y (3) el cliente verá el precio final antes de confirmar. Pendientes: conectar clima (con caché por zona) y un interruptor de emergencia manual.

## Sin cambios en la base de datos
La simulación vive dentro del JSON `deliveryPricing`, así que **no hace falta `db:push`**. Los pedidos anteriores no tienen simulación y no aparecen en el reporte.

## Pruebas
- Unitarias: `server/lib/pricing-rules.test.ts` (señales, topes, resumen) y `server/lib/google-routes.test.ts` (minutos sin tráfico).
- Integración (MySQL de pruebas): `server/pricing.integration.test.ts` comprueba que la simulación se guarda y que el total cobrado no cambia.
