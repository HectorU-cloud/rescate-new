# Tarifas configurables y desglose del precio

## Qué cambia
- **La tarifa de servicio ahora sale de la configuración del admin** (Finanzas → Configuración de tarifas). Antes el servidor y el carrito cobraban $0,45 escritos en el código, y cambiar el campo en el panel no tenía efecto.
- **El carrito muestra la tarifa que cobrará el servidor** (`orders.fees`, pública). Mientras no cargue, el botón de confirmar queda bloqueado en lugar de mostrar un total que podría ser falso.
- **Envío mínimo y máximo configurables** (antes fijos en $1,50 y $12 dentro del código). El servidor rechaza guardar un máximo menor que el mínimo.
- **Cada pedido a domicilio o de retiro guarda cómo se calculó su precio** en `orders.deliveryPricing` (JSON): versión de la fórmula, proveedor de ruta (`google` o `fallback`), distancia, minutos, base, precio por km y por minuto, cada componente, la suma sin acotar, los topes usados, si el tope mínimo o máximo cambió el resultado (`clamp`), el envío cobrado y la tarifa de servicio. Los pedidos anteriores quedan con `null`.

## Reglas
- Los cambios de configuración valen solo para pedidos **nuevos**: los ya creados conservan lo que aceptó el cliente (importes y desglose).
- Si el admin todavía no guardó la configuración (no existe la fila), la tarifa de servicio usa el valor de lanzamiento (USD 0,45) y el envío usa las tarifas de cada local sin topes, igual que antes.
- La fórmula está en `contracts/pricing.ts` (`priceDelivery`) y la usan la cotización aproximada y la de Google Routes. Si cambias la fórmula, sube `PRICING_FORMULA_VERSION`.
- Los precios dinámicos (tráfico, clima, demanda) **siguen sin cobrarse**: el interruptor solo guarda la preferencia. Desde ahora se **simulan** y se guardan junto al pedido sin afectar el total (ver `PRECIO_DINAMICO_SIMULACION.md`).

## Límite conocido
El carrito muestra la tarifa vigente al abrirlo; el servidor cobra la vigente al confirmar. Si el admin la cambia justo entre ambos momentos, el total cobrado puede diferir de lo que se vio. Es una ventana de segundos; si te preocupa, el siguiente paso es enviar el total esperado al confirmar y pedir confirmación cuando no coincida.

## Base de datos
Cambios: columna `orders.deliveryPricing` (JSON, nula) y columnas `finance_settings.minDeliveryFee` (por defecto 1,5) y `maxDeliveryFee` (por defecto 12). Haz una copia de seguridad, revisa el SQL que propone Drizzle y ejecuta:

```bash
npm run db:push
npm run check
npm test
npm run build
```

## Pruebas
- Unitarias: `server/lib/pricing-rules.test.ts` (fórmula, topes, desglose) y un caso nuevo en `server/lib/google-routes.test.ts`.
- Integración (MySQL de pruebas): `server/pricing.integration.test.ts`. Modifica la fila única de configuración financiera y la restaura al terminar.
