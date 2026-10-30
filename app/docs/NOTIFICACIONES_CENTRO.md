# Centro de notificaciones y mapa del repartidor

## Qué hay
- **Historial dentro de la app** (`notifications`): cada aviso que se envía por push (`sendPushToUser`) se guarda antes en el historial del usuario, aunque Firebase no esté configurado o el usuario no tenga dispositivos. Los avisos con la misma etiqueta sin leer (p. ej. el chat de un pedido) se agrupan en uno.
- **Campana 🔔** en la cabecera con el número de avisos sin leer (se refresca cada 30 s, al volver a la pestaña y al llegar un push con la app abierta) y la página `/notificaciones`: marcar uno o todos como leídos, abrir el pedido, «Ver más».
- **Retención:** los leídos se borran a los 30 días y los no leídos a los 90 (tarea cada 6 horas en `startMaintenance`). Al eliminar la cuenta se borra todo el historial del usuario.
- **Nuevo aviso:** el cliente recibe «Ya tienes repartidor 🛵» cuando un repartidor toma su pedido (antes solo se avisaba al comercio).
- **Mapa del repartidor:** en «Entregas en curso» se dibuja su posición, el destino y la línea punteada de referencia (el mismo mapa que ve el cliente). Para la ruta por calles sigue el botón «Ir con el cliente».

## Base de datos (tabla nueva `notifications`)
En producción ejecuta `db/manual/2026-10-notifications.sql` (es seguro repetirlo). En local, `npm run db:push`.

## Importante: estado de `db/migrations`
La carpeta tiene archivos que `drizzle-kit migrate` **no aplica**: `meta/_journal.json` solo lista `0000_married_siren`, pero existen `0001_chubby_echo.sql`, `0001_loud_silvermane.sql` (tablas de finanzas) y `0002_google_routes_metadata.sql`. Antes de usar `migrate` en producción conviene dejar una sola línea base limpia (ver README, sección «Migraciones»).

## Lo que NO hace todavía (a propósito)
- Ruta real por calles: la línea es una referencia visual. Se reemplazará con la geometría de Google Routes cuando actives esa integración (`GOOGLE_ROUTES_ENABLED` sigue en `false`).
- GPS en segundo plano: es una app web; el repartidor debe tener la pantalla abierta con permiso de ubicación.
- Tiempo real por WebSocket: el cliente consulta cada ~8 s (suficiente para este volumen).
