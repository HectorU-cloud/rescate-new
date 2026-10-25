# Revisión de cambios de nombre y dirección de comercios

- El comercio aprobado conserva el nombre y dirección publicados mientras el nuevo dato queda en `pendingName` o `pendingAddress`.
- Admin → Comercios → Por aprobar incluye también solicitudes de cambio y permite comparar el dato actual con el propuesto.
- Aprobar aplica los campos pendientes y los limpia.
- Rechazar limpia la propuesta y conserva los datos publicados. El comercio recibe una notificación.
- No se cambia `approvalStatus` cuando solo hay una propuesta de nombre/dirección, por lo que el comercio aprobado sigue publicado con sus datos anteriores.

## Migración

Ejecutar `npm run db:push` y revisar que solo agregue `pendingName` y `pendingAddress` a `businesses`. No aceptar renombrados ni eliminaciones de columnas existentes.
