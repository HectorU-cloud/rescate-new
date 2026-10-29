# Modelo inicial de comisiones y modalidad de entrega

## Decisión para el lanzamiento
- Comisión al negocio: 0% durante la fase piloto. No se descuenta comisión del subtotal del comercio.
- Tarifa de servicio al cliente: USD 0,45 por pedido, visible en el carrito. Es una tarifa inicial de prueba y debe validarse con costos reales, impuestos y asesoría contable antes de producción.
- Envío: solo para pedidos a domicilio; el importe se registra en `deliveryFee` y corresponde al repartidor asignado.
- Propina: no incluida; cuando se implemente, se debe separar del ingreso de Rescate.
- Pago actual: efectivo. El flujo de tarjeta no se habilita con este cambio.

## Modalidades
- `fulfillmentMethod = delivery`: dirección y GPS obligatorios; calcula el envío y el pedido puede aparecer en la cola de repartidores.
- `fulfillmentMethod = pickup`: el cliente recoge el pedido en el local; envío = USD 0, no se exige dirección/GPS y no se notifica a repartidores. El negocio marca el pedido como listo y luego entregado al cliente.
- Los pedidos existentes conservan `delivery` por defecto.

## Instalación
1. Haz una copia de seguridad de la base de datos y del proyecto.
2. Ejecuta `npm install`.
3. Ejecuta `npm run db:push` y revisa que solo se agreguen las columnas `fulfillmentMethod` y `serviceFee` a `orders`; `serviceFee` debe tener valor predeterminado 0 para no alterar pedidos históricos; no aceptes renombrar ni eliminar columnas.
4. Ejecuta `npm run check`, `npm test` y `npm run build`.
5. Prueba: pedido a domicilio asigna repartidor y cobra envío; retiro no pide GPS, no muestra envío y nunca aparece en la cola de repartidores; el comercio puede marcar listo y entregado. Comprueba además que los totales históricos no se recalculen.

## Nota
La tarifa USD 0,45 es configurable en el código como valor inicial, no una conclusión de rentabilidad. Antes de abrir al público hay que confirmar IVA/facturación y comprobar que el costo de soporte, infraestructura y cobro efectivo no supere el ingreso.

## Ajuste de seguimiento: retiro de pedidos del menú

Para pedidos `type=delivery` con `fulfillmentMethod=pickup`, el seguimiento del cliente debe usar estas etapas: Pendiente → Aceptado → Preparando → Listo para retirar → Retirado. No debe mostrar “En camino”, mapa GPS ni datos de repartidor. La confirmación de retirada se realiza desde el panel del comercio cuando el estado está en `ready`, pasando a `delivered`.

Los pedidos a domicilio conservan el flujo: Pendiente → Aceptado → Preparando → Listo → En camino → Entregado.
