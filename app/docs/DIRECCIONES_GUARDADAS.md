# Direcciones guardadas del cliente

## Qué incluye
- Un cliente autenticado puede guardar una dirección con nombre y coordenadas GPS.
- Las direcciones se listan solo para el usuario autenticado; eliminar una dirección comprueba también su propietario.
- Límite de 10 direcciones por cliente.
- En el carrito se puede seleccionar una dirección guardada para rellenar dirección y GPS sin volver a compartir ubicación.
- La primera dirección se guarda como principal. La etiqueta principal es informativa; el usuario aún debe seleccionar una dirección en el carrito.

## Instalación
1. Haz una copia de seguridad de la base de datos.
2. En `app/`, ejecuta `npm run db:push`.
3. Revisa el diff de Drizzle y acepta crear la tabla nueva `customer_addresses`. No renombres ni elimines tablas o columnas existentes.
4. Ejecuta `npm run check`, `npm test` y `npm run build`.

## Prueba manual
1. Inicia sesión como cliente y añade productos al carrito.
2. Escribe una dirección y usa la ubicación GPS.
3. Pon una etiqueta como `Casa` y pulsa `Guardar dirección`.
4. Recarga la página y comprueba que aparece en `Mis direcciones guardadas`.
5. Selecciónala y comprueba que se rellenan la dirección y las coordenadas; confirma que la cotización de envío se recalcula.
6. Elimina la dirección y comprueba que desaparece.
7. Inicia sesión con otro cliente y confirma que no puede ver ni eliminar la dirección anterior.

## Garantías (cubiertas por pruebas en `api/flows.integration.test.ts`)
- Guardar es atómico: se bloquea la fila del usuario dentro de una transacción, así que guardados simultáneos no superan las 10 direcciones ni dejan dos principales.
- La lista sale con la principal primero y luego las más recientes.
- Al borrar la principal, la más reciente de las que quedan pasa a ser la principal.
- Borrar una dirección ajena no hace nada (ni borra ni avisa si existe).
