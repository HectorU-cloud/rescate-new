# Rescate — Perfil y confianza del repartidor

## Cambios incluidos

- Perfil público del repartidor: nombre, foto por URL HTTPS, vehículo, placa opcional y presentación.
- Verificación manual: guardar el perfil lo deja `pending`; mientras no esté `approved`, el backend no muestra pedidos disponibles ni permite aceptarlos.
- Revisión de administradores: abrir `/admin/repartidores` con una cuenta cuyo `role` sea `admin` para aprobar o rechazar perfiles pendientes. El rechazo admite una nota para indicar qué debe corregirse.
- Estados de delivery diferenciados: `ready` (listo para repartidor), `assigned` (repartidor asignado y yendo al comercio), `arrived` (llegó al comercio), `picked_up` (recogió y va al cliente), `delivered` (entregado).
- Chat del pedido entre cliente y repartidor asignado, con actualización periódica y notificación push de mejor esfuerzo. El backend restringe el acceso a las dos personas vinculadas al pedido y cierra el envío al finalizar/cancelar.
- Valoración de 1 a 5 estrellas y comentario opcional, solo por el cliente del pedido después de una entrega completada, una vez por pedido.
- Conserva los módulos de GPS, catálogo, imágenes, S3/R2 y notificaciones que estaban en el ZIP fuente.

## Instalación segura

1. Haz copia de seguridad de MySQL.
2. Descomprime el ZIP en una carpeta nueva y conserva la versión anterior.
3. En `app`, configura `.env` con los valores de tu entorno; no compartas ni subas secretos.
4. Instala dependencias con `npm install` (si existe `package-lock.json`, preferiblemente usa `npm ci`).
5. Ejecuta `npm run db:push` para añadir las columnas y tablas nuevas y actualizar el enum de estados. Revisa el diff y respalda la base antes de aceptar cambios.
6. Ejecuta `npm run check`, `npm run build` y `npm test`.
7. Inicia con `npm run dev` y prueba primero en una base de datos de desarrollo.

## Cómo probar

1. Inicia sesión como usuario que pueda usar el rol de repartidor y abre `/repartidor`.
2. Completa nombre, vehículo y, opcionalmente, una foto pública HTTPS, placa y presentación; pulsa **Guardar y enviar a revisión**.
3. Con una cuenta administrativa, abre `/admin/repartidores` y aprueba el perfil. Un repartidor no aprobado no debe poder tomar pedidos incluso si intenta llamar directamente al endpoint.
4. Crea un pedido de delivery de prueba y haz que el comercio lo deje en `ready`.
5. Como repartidor aprobado, acepta el pedido. El estado debe pasar a `assigned`; pulsa **Llegué al comercio** para `arrived`, luego **Confirmar que recogí el pedido** para `picked_up` y al final **Marcar como entregado**.
6. Desde la cuenta del cliente, verifica el perfil del repartidor, estados, GPS y chat. Prueba que otra cuenta no pueda leer ni enviar mensajes a ese pedido.
7. Una vez entregado, envía una valoración; intenta enviarla otra vez y confirma que el servidor la rechaza.

## Notas y límites

- La foto se proporciona mediante una URL HTTPS. Usa una URL de imagen pública controlada por Rescate; no pegues credenciales ni enlaces privados. La subida directa de foto de perfil a S3/R2 no se añade en esta fase.
- El estado “identidad revisada” significa que un administrador aprobó manualmente el perfil en Rescate; no implica verificación automática de documentos oficiales. El proceso humano debe realizarse realmente antes de aprobar.
- El chat se actualiza por polling y manda una push best-effort; no es WebSocket. La entrega push depende de la configuración existente de Firebase.
- El tiempo de llegada estimado no se inventa: esta fase no incorpora cálculo de ETA.
- `db:push` cambia el enum SQL de pedidos y agrega campos/tablas; probar primero en staging.
