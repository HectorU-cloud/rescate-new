# Recargo por mal clima

Monto fijo que se suma al **envío** cuando hace mal tiempo en el local y va **completo al repartidor** (es parte de `deliveryFee`, así que entra en «ganancias» y en el cobro en efectivo). El local no lo paga ni lo ve como descuento.

## Cómo se activa (Admin → Finanzas → «Recargo por mal clima»)
- **Cuándo se cobra:** Nunca (por defecto) · Solo lluvia fuerte o tormenta · Cualquier lluvia o llovizna.
- **Recargo ($):** 0,50 por defecto.
- Requiere en Railway `WEATHER_ENABLED=true` y `OPENWEATHER_API_KEY`. Sin clima (clave ausente, error, tiempo agotado) **no se cobra**.

## Qué ve cada quien
- **Cliente:** en el carrito, dentro de «Cómo se calcula el envío»: «🌧️ Recargo por lluvia fuerte (para el repartidor) $0,50». El total de envío ya lo incluye.
- **Repartidor:** el botón «Tomar» muestra su ganancia con el recargo y «incluye $0,50 por lluvia».
- **Pedido guardado:** `deliveryPricing.weatherFee` y `weatherCondition` (solo si se cobró).

## Reglas
- El recargo va **fuera** de los topes de envío mínimo/máximo.
- El clima se consulta por zona de ~5 km y se reutiliza 10 minutos: el precio no cambia de un segundo a otro.
- Protección: el carrito envía el envío que el cliente vio (`expectedDeliveryFee`). Si al confirmar el envío subió (p. ej. empezó a llover), el servidor responde «El costo de envío cambió…» y el carrito se actualiza; nunca se cobra más de lo que el cliente vio sin avisarle.
- La **simulación de precio dinámico** sigue midiendo el envío sin este recargo (para no contarlo dos veces).

## Base de datos
Columnas nuevas en `finance_settings`: `db/manual/2026-11-weather-surcharge.sql` (ejecutar **una vez** en producción; en local `npm run db:push`). Queda en «off».
