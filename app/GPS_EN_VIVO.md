# GPS en vivo del repartidor

Se agregó una primera implementación de seguimiento GPS para los pedidos de tipo `delivery`.

## Cómo funciona

- Cuando el repartidor tiene un pedido en estado `picked_up` y abre el Panel del repartidor, el navegador solicita permiso de ubicación.
- Con el permiso concedido, se envía la última posición GPS cada ~8 segundos al backend.
- El backend solo acepta posiciones del repartidor asignado a ese pedido activo.
- El cliente que tiene autorización para ver el pedido consulta la ubicación cada 8 segundos y el mapa muestra el punto más reciente.
- Si la posición tiene más de 2 minutos, se marca como desactualizada y no se presenta como GPS en vivo.
- Al marcar el pedido como entregado, se elimina la ubicación almacenada.

## Activación

1. Haz una copia de seguridad de tu base de datos.
2. En la carpeta `app`, instala dependencias con `npm install`.
3. Configura `.env` usando `.env.example` como referencia. No subas `.env` a GitHub.
4. Ejecuta `npm run db:push` para crear la tabla `courier_locations`.
5. Ejecuta `npm run check` y `npm run build`.
6. Inicia la app y entra con una cuenta de repartidor.
7. Acepta un pedido de delivery; permite ubicación en el navegador y deja abierto el Panel del repartidor.
8. Desde la cuenta cliente, abre el detalle del mismo pedido y comprueba que el punto se actualice.

## Límites de esta primera versión

- Es una implementación web: el navegador debe permanecer abierto y con permiso de ubicación. No garantiza seguimiento en segundo plano ni con el navegador cerrado.
- En despliegues públicos, la geolocalización normalmente requiere HTTPS (localhost sirve para desarrollo).
- La actualización es por sondeo cada ~8 segundos, no por WebSockets.
- Las notificaciones push no están incluidas en este cambio.
