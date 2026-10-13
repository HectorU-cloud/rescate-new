# Confirmación segura de entrega

## Qué cambia

- Al asignarse un pedido de delivery a un repartidor, el backend genera un código aleatorio de seis dígitos.
- El código se muestra solamente al cliente propietario en el detalle del pedido mientras la entrega está activa.
- El panel del repartidor solicita ese código antes de finalizar la entrega.
- El backend valida que la cuenta tenga rol de repartidor aprobado, que el pedido esté asignado a esa cuenta, que sea delivery, que siga en estado `picked_up` y que el código coincida.
- Al completar la entrega, el código se elimina de la fila del pedido y se elimina la ubicación GPS asociada.
- Las consultas del panel del repartidor y del comercio no exponen el código.

## Instalación

1. Haz una copia de seguridad de MySQL.
2. Descomprime el ZIP en una carpeta nueva y entra en `Rescate/app`.
3. Ejecuta `npm install`.
4. Ejecuta `npm run db:push`. Cuando Drizzle pregunte por `deliveryConfirmationCode`, selecciona **crear columna nueva** (`+ deliveryConfirmationCode`). No renombres campos existentes.
5. Ejecuta `npm run check`, `npm run build`, `npm test` y `npm run dev`.

## Pruebas manuales

1. Como cliente, crea un pedido de delivery y espera a que el comercio lo marque como listo.
2. Como repartidor aprobado, acepta el pedido.
3. En el detalle del pedido del cliente, verifica que aparezca un código de seis dígitos.
4. En el panel del repartidor, intenta confirmar con un código incorrecto: debe rechazarlo y mantener el pedido activo.
5. Ingresa el código correcto: el pedido debe pasar a `delivered` y el código dejar de mostrarse.
6. Comprueba que el panel del comercio y la respuesta de `courier.myDeliveries` nunca incluyan el código.
7. Intenta confirmar un pedido de otro repartidor o con una cuenta no aprobada: debe devolver error de autorización.

## Consideraciones

- El cliente debe compartir el código únicamente al recibir físicamente el pedido.
- Esta primera versión utiliza el código como confirmación de recepción, no como prueba legal de entrega.
- Antes de producción con tráfico elevado, conviene añadir limitación persistente de intentos por pedido y registrar auditoría de confirmaciones.
