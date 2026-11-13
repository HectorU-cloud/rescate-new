# Local, repartidor y tarifa de servicio (cambios)

## 1. Aviso al cerrar el local
Al pulsar «Abierto» para cerrar, sale un aviso: «No aceptarás más pedidos. Si tienes pedidos en cola o pendientes, los puedes hacer o cancelar» (con cuántos pedidos activos hay). Mientras está cerrado, el panel lo recuerda. Los pedidos en curso se siguen pudiendo avanzar o cancelar (el servidor no lo bloquea por estar cerrado).

## 2. El código de retiro lo da el repartidor
- Al tomar el pedido, el repartidor ve su código de 6 dígitos (en «Pedidos por recoger»). **El local ya no lo puede leer.**
- El repartidor se lo dice al local; el local lo escribe en su panel (`business.confirmCourierPickup`) y recién ahí el pedido pasa a «en camino». `courier.confirmPickup` ya no existe.
- 5 intentos fallidos bloquean el código (el pedido sigue siendo del repartidor): el repartidor genera uno nuevo con «🔄 Generar código nuevo» (`courier.regeneratePickupCode`). Quien adivina no puede reiniciar el contador.
- El barrido de 15 min sigue igual: si el local no confirma el código, se libera la reserva.

## 3. Tarifa de servicio solo al local, con corte quincenal
- Al confirmarse la entrega, el cargo de la tarifa (`serviceFee`, p. ej. 0,45) va al **monedero del local**. El repartidor ya no genera deuda nueva (los saldos viejos no se tocan).
- Corte quincenal: del 1 al 15 y del 16 al último día del mes, hora de Ecuador (`contracts/fees.ts → cutPeriodFor`). El saldo del corte sale del monedero del local (cargos − pagos confirmados); los pagos siguen reportándose y confirmándose como hasta ahora.
- Siguen vigentes el límite de deuda del local (Finanzas del admin) y el bloqueo al superarlo.

## 4. Reporte del día con PDF
- Botón «📄 Reporte del día» en el panel del local y, automáticamente, al cerrar el local.
- Muestra ventas (sin envío), pedidos entregados y cancelados, la tarifa que el local debe por ese día y el estado del corte quincenal. Se puede elegir otro día y descargar el PDF (`src/lib/simple-pdf.ts`, sin dependencias nuevas).
- Servidor: `business.report`.

## 5. Reseñas
Ya existía la pestaña «Reseñas». Ahora además: resumen con promedio y barras por estrellas, tarjeta «Lo que dicen tus clientes» con los últimos comentarios en el panel y aviso (push) al dueño cuando llega una reseña nueva.

## 6. Pantalla de pago del repartidor
Cuando el local confirma el código, al repartidor le sale una pantalla con lo que debe pagarle al local: **precio del pedido + tarifa de servicio** (plato 10 + 0,45 = 10,45). Queda también en la tarjeta de la entrega en curso. El local ve el mismo monto («Cobra al repartidor…»). El cliente paga el total completo; el envío es del repartidor. Cálculo: `courierPayToBusiness`.

## Pruebas
`npm test` (hay tests nuevos en `server/lib/fees.test.ts`, `src/lib/simple-pdf.test.ts` y casos nuevos en `flows.integration.test.ts`, que necesitan MySQL como los demás de integración).
