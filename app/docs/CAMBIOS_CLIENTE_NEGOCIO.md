# Mejoras para cliente y comercio

## 1. El cliente ve quién le lleva el pedido
En el detalle del pedido aparece una tarjeta con **foto, primer nombre, vehículo, placa y calificación** del repartidor.

- Se muestra solo en delivery, con el pedido **en camino** o **entregado** (no antes de que lo recoja ni si se cancela).
- `orders.byId` devuelve `courier` con una lista cerrada de campos (`api/lib/courier-public.ts`): nunca correo, teléfono ni estado de aprobación.
- El propio repartidor no recibe esta tarjeta; un tercero no puede ver el pedido (como antes).

## 2. Ventas correctas y estadísticas de hoy
`business.stats` antes sumaba `total` (incluye el envío, que es del repartidor) de todos los pedidos no cancelados, aunque aún no se entregaran.

- **Ventas** = suma del `subtotal` de pedidos **entregados**, sin envío.
- Nuevo: ventas de hoy, entregados hoy / recibidos hoy. "Hoy" empieza a las 00:00 de Ecuador (`startOfDayEcuador`).
- El panel de admin ya sumaba solo entregados y separa los envíos; no cambió.

## 3. Pedidos que no avanzan y alerta sonora

**Cancelar desde cocina.** El comercio ahora puede cancelar un **delivery** en `preparing` o `ready` (sin repartidor), con **motivo obligatorio** (mín. 5 caracteres) que el cliente verá. Si el repartidor lo toma justo en ese instante, la condición de estado es atómica y gana uno solo. Los rescates siguen cancelándose solo en `pending`/`accepted`.

**Vencimiento automático** (`sweepOrders`, solo delivery; los rescates esperan al cliente dentro de su ventana de retiro):

| Tiempo en `accepted`/`preparing` | Qué pasa |
| --- | --- |
| 25 min (`businessProgressReminderMin`) | Push al comercio, una sola vez por estado |
| 60 min (`businessProgressTimeoutMin`) | Cancelación automática, aviso al cliente y al comercio |

El tiempo se mide con `updatedAt`. Al guardar el recordatorio se conserva ese valor, para no reiniciar el reloj. Al cambiar de estado el recordatorio se reinicia. En el panel, cada pedido muestra "⏱️ En este estado hace X min" y se pone en rojo pasado el recordatorio.

**Alerta sonora** (panel del comercio, pestaña Pedidos):
- Sonido y aviso en pantalla cuando llega un pedido nuevo; se repite cada 30 s mientras haya pedidos sin aceptar; el título de la pestaña muestra el conteo.
- Botón para silenciar/activar (se recuerda en el dispositivo). El navegador exige un toque en la pantalla antes de permitir audio; el botón y el primer clic lo habilitan.
- Si el servidor tiene push configurado y el dispositivo no lo activó, aparece un aviso que lleva a Perfil.

## Puesta en marcha
```bash
npm run db:push     # agrega orders.businessReminderSentAt (copia de seguridad antes)
npm run check
npm test
```

## Archivos
`contracts/constants.ts`, `db/schema.ts`, `api/lib/{courier-public,order-rules,business-rules,maintenance,push-notifications}.ts`,
`api/{orders-router,business-router}.ts`, `src/lib/{new-orders,alert-sound}.ts`, `src/hooks/useNewOrderAlert.ts`,
`src/pages/{OrderDetail,BusinessPanel}.tsx`, `vitest.config.ts` (ahora también incluye `src/**/*.test.ts`).
