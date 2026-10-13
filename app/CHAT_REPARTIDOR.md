# Chat cliente ↔ repartidor (con aviso push)

Permite que el cliente y el repartidor coordinen la entrega (puerta, referencias, demoras) sin
intercambiar teléfonos. Cada mensaje nuevo avisa por push al otro participante.

## Reglas

- **Quién participa:** solo el cliente del pedido y el repartidor asignado. El comercio, el admin y
  cualquier tercero reciben "No puedes acceder al chat de este pedido".
- **Cuándo se puede escribir:** solo en pedidos de **delivery** con estado **`picked_up`** (en camino)
  y repartidor asignado. Al entregarse, el chat queda como historial de solo lectura. No hay chat en rescates.
- **Hilo por repartidor:** cada mensaje guarda el `courierId`. Si el repartidor suelta el pedido y lo toma
  otro, el nuevo no ve los mensajes del anterior y el anterior pierde el acceso.
- **Código de confirmación:** se rechaza cualquier mensaje que contenga el código de entrega (se comparan
  solo los dígitos, así que `482 913` o `4-8-2-9-1-3` también se bloquean). El código solo se dice en persona.
- **Límites:** 500 caracteres por mensaje y 10 mensajes por minuto por persona y pedido.
- **Lectura:** el chat abierto marca como leídos los mensajes recibidos (`✓ visto` para quien envió).

## Aviso push

- Título `💬 <Nombre> · tu repartidor` / `tu cliente`, texto con los primeros ~90 caracteres del mensaje.
- El cliente abre `/pedido/:id#chat` (el chat se despliega solo); el repartidor abre `/repartidor`.
- Usa el `tag` `rescate-chat-<pedido>` para no reemplazar las notificaciones de estado del pedido y para
  que varios mensajes seguidos se agrupen en una sola notificación.
- Es best-effort, igual que el resto de push: si Firebase no está configurado o falla, el mensaje igual se guarda.
- Con la app abierta se muestra el aviso (toast) y el chat se actualiza solo cada 4 s.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `db/schema.ts` | Nueva tabla `order_messages` |
| `api/lib/chat-rules.ts` | Reglas puras (quién, cuándo, código, vista previa) |
| `api/chat-router.ts` | `chat.list`, `chat.send`, `chat.markRead` |
| `api/lib/push-notifications.ts` | `notifyChatMessage` y `tag` opcional |
| `public/firebase-messaging-sw.js` | Usa el `tag` recibido |
| `src/components/ChatBox.tsx` | Interfaz del chat |
| `src/pages/OrderDetail.tsx`, `CourierPanel.tsx` | Muestran el chat |

## Puesta en marcha

```bash
npm run db:push        # crea la tabla order_messages (haz copia de seguridad antes)
npm run check
npm test
```

El service worker cambió: tras desplegar, los navegadores lo actualizan solos, pero conviene recargar
una vez la pestaña de prueba.

## Pruebas

- Unitarias (`api/lib/chat-rules.test.ts`): no necesitan base de datos.
- Integración (`api/flows.integration.test.ts`, bloque "chat cliente–repartidor"): permisos, estados,
  código de confirmación, spam, lectura, cambio de repartidor y rescates. Requieren `TEST_DATABASE_URL`.

## Mejoras posibles

- Que el admin pueda leer el chat de un pedido con reclamo abierto.
- Conteo de mensajes sin leer en la lista de pedidos / panel del repartidor.
- Reemplazar el sondeo de 4 s por WebSocket/SSE si crece el tráfico.
