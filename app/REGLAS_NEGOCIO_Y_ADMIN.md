# Reglas de negocio, caminos de falla, push a repartidores y administración

## 1. Arreglo de `npm run check`
`AdminCourierReview.tsx` usaba `profile.pendingCouriers` y `profile.reviewCourierVerification`, que no existían en el backend.
Se agregaron en `api/profile-router.ts` (solo admin) y se añadieron a `users` las columnas `courierVerification` (pending/approved/rejected) y `courierReviewNote`.
La pantalla ahora está en `/admin/verificacion`. Guardar un cambio de foto, vehículo o placa vuelve el perfil a revisión.

## 2. Push a repartidores
- Cuando el comercio marca un delivery como **listo** se avisa a todos los repartidores aprobados y *disponibles* (`api/lib/push-notifications.ts → notifyCouriersOrderReady`).
- El repartidor puede activar/desactivar su disponibilidad en `/repartidor`.
- Si a los 8 min nadie lo toma, se envía un recordatorio (una sola vez).
- También se avisa al comercio cuando un repartidor toma el pedido, y a admins ante nuevos reclamos o comercios por aprobar.

## 3. Reglas de negocio (`contracts/constants.ts → BUSINESS_RULES`, `api/lib/business-rules.ts`)
| Regla | Detalle |
|---|---|
| Radio de entrega | Por comercio (`deliveryRadiusKm`, máx. 15 km). Se mide con Haversine × 1.3 (factor de calles). |
| Tarifa por distancia | `deliveryFee` (base) + `feePerKm` × km. **La calcula siempre el servidor**; el cliente no la puede fijar. |
| Pedido mínimo | `minOrder` por comercio, validado en el servidor. |
| Horarios | `opensAt`/`closesAt` en hora de Ecuador (UTC-5); soporta cruzar medianoche. Además del botón manual Abierto/Cerrado. |
| Ubicación | Ahora **obligatoria** en delivery (sin ella no hay distancia ni tarifa). |
| Aprobación | Los comercios nuevos quedan `pending` y no se muestran hasta que un admin los apruebe. |

## 4. Caminos de falla
- **Cliente**: solo puede cancelar en `pending` y `accepted`. Desde "preparando", "listo" y "en camino" ya no puede (mensaje claro en pantalla y bloqueo en el servidor); en su lugar puede enviar un **reclamo**.
- **Repartidor no puede soltar libremente**: solo dentro de los primeros 5 min tras tomarlo, con motivo; el pedido vuelve a "listo" y se avisa de nuevo. Después debe contactar soporte.
- **Nadie toma el pedido**: a los 20 min se cancela automáticamente (`cancelledBy = system`), con aviso al cliente y al comercio.
- **El comercio no responde**: un pedido `pending` se cancela a los 15 min.
- La toma de pedido es **atómica**: si dos repartidores pulsan a la vez, solo uno lo obtiene. Máximo 2 entregas activas por repartidor.
- Todo queda en `order_events` (auditoría).
- Los tiempos están en `BUSINESS_RULES`. Un temporizador interno (`api/lib/maintenance.ts`, cada 60 s) los aplica.

## 5. Administración (`/admin`)
- **Métricas**: pedidos hoy/total, ventas, tiempo medio de entrega, tasa de cancelación, vencidos, repartidores disponibles, pendientes de aprobación, reclamos abiertos, últimos 7 días y top comercios.
- **Comercios**: aprobar, rechazar o suspender (con motivo, que ve el comercio).
- **Pedidos**: filtro por estado, historial de eventos y cancelación por admin con motivo.
- **Reclamos**: listado, resolver o rechazar con respuesta que recibe el cliente.

## 6. Migración (haz copia de seguridad antes)
```bash
npm install
npm run db:push
```
Revisa lo que propone `db:push`:
- Agrega columnas/tablas nuevas (`order_events`, `claims`, etc.).
- **Elimina de `businesses` las columnas `courierPhotoUrl/Vehicle/Plate/Bio/Approved`**, que se habían pegado ahí por error (no las usa nadie). Acepta ese borrado.

Luego ejecuta en MySQL para no perder estados existentes:
```sql
UPDATE users SET courierVerification = 'approved' WHERE courierApproved = 1;
-- Los comercios existentes quedan 'approved' por defecto. Si quieres revisarlos de nuevo:
-- UPDATE businesses SET approvalStatus = 'pending';
```

## 7. Pruebas
`npm test` ahora ejecuta `api/lib/business-rules.test.ts` (distancia, tarifa, radio y horarios).

## 8. Pendiente / fuera de alcance
- Reembolsos y pagos en línea (hoy solo efectivo).
- Valoración de repartidores y chat cliente–repartidor (descritos en `REPARTIDOR_CONFIANZA.md` pero no implementados en el código).
- Los packs de rescate no validan ventana de retiro al reservar.
- Reclamos abiertos por comercio o repartidor (el esquema ya lo permite; la UI solo expone el del cliente).
- Para varias instancias del servidor conviene mover el temporizador a un cron externo (las cancelaciones ya son atómicas, no se duplican).
