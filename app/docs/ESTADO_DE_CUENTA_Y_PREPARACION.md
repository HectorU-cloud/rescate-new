# Estado de cuenta, límite de deuda, preparación y pedidos ocultos

## Estado de cuenta (repartidor y comercio)
- Tarjeta «Estado de cuenta» en `/repartidor` y `/panel` (`WalletCard`, `wallet.mine`): saldo que se debe a Rescate, barra frente al límite, pagos por verificar y últimos movimientos. La persona solo ve sus propios movimientos y sin datos internos (quién los creó o revisó).
- Saldo = cargos confirmados − pagos confirmados (+ ajustes). Un pago **pendiente** no descuenta hasta que el admin lo confirme (Admin → Finanzas). Reglas en `contracts/wallet.ts`.

## Límite de deuda (nuevo: ahora SÍ se aplica)
Los límites de Admin → Finanzas (`courierDebtLimit` / `businessDebtLimit`) estaban configurables pero no se aplicaban en ninguna parte. Ahora:
- Aviso amarillo desde el **80 %** del límite.
- Con la deuda **por encima** del límite: el repartidor no puede tomar pedidos (`courier.accept`) y el comercio no puede aceptar pedidos nuevos (`business.updateOrderStatus` → `accepted`). Todo lo ya aceptado sigue su curso.
- Un límite de **0** desactiva el bloqueo. Si al activarlo hay gente que ya está por encima, quedará bloqueada hasta que su pago sea confirmado: revisa Admin → Finanzas antes de desplegar.

## Tiempo de preparación (comercio)
Al aceptar un pedido a domicilio el comercio elige 10/15/20/30/45 min. Se guarda `prepMinutes` y `estimatedReadyAt`; el cliente lo ve en el detalle del pedido y en el aviso «Pedido confirmado».

## Rechazar pedidos (repartidor)
«No me interesa» oculta el pedido del tablero **en ese dispositivo** (no cambia nada en el servidor ni para otros repartidores). Aparece «Hay N pedidos ocultos · Mostrar» para recuperarlos.

## Base de datos
Columnas nuevas en `orders`: `db/manual/2026-11-prep-time.sql` (ejecutar **una vez** en producción; en local `npm run db:push`).
