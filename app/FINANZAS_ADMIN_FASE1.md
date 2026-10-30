# Rescate — Finanzas administrativas (fase 1)

## Incluye
- Pestaña **Finanzas** en Administración.
- Configuración persistente: servicio al cliente (por defecto USD 0,45), límites de deuda sugeridos, parámetros iniciales de envío y bandera de precios dinámicos.
- Monederos calculados a partir de movimientos, sin saldo editable manualmente.
- Registro administrativo de cargos y pagos pendientes de verificación.
- Un pago pendiente no reduce la cuenta por cobrar; solo un pago confirmado lo hace.
- Historial reciente de pagos pendientes para revisión.

## Importante
Esta fase **no genera cargos automáticamente al completar pedidos**, no bloquea repartidores/negocios por deuda y no activa tarifas dinámicas en el checkout. Se deja así intencionalmente hasta confirmar quién debe la tarifa de servicio en cada modalidad y quién cobra/distribuye el envío. No se debe usar el registro manual para duplicar cargos.

## Base de datos
El esquema añade `wallet_entries` y `finance_settings`. En un entorno de desarrollo, revisa el cambio y ejecuta:

```bash
npm run db:push
npm run check
npm test
npm run build
```

Haz una copia de seguridad antes de aplicar cambios a una base de datos con datos reales. Revisa el SQL que propone Drizzle antes de confirmarlo.

## Reglas del libro financiero
- `charge` confirmado: aumenta lo que la cuenta debe a Rescate.
- `payment` pendiente/rechazado: no reduce saldo.
- `payment` confirmado: reduce el saldo pendiente.
- Los movimientos se conservan para auditoría; no editar ni borrar para corregir un error. En una siguiente fase se añadirá un movimiento de reverso/ajuste explícito.
- La bandera de precios dinámicos solo guarda la preferencia y no modifica tarifas todavía.

## Siguiente fase
1. Confirmar reglas de cobro para delivery en efectivo, transferencia directa y pickup.
2. Generar cargos automáticamente de forma idempotente al cerrar pedidos.
3. Implementar bloqueos con aviso, umbral configurable y protección de pedidos en curso.
4. Cotizador de rutas y después clima/demanda, con máximos y precio visible antes de confirmar.

## Endurecimiento posterior (validación de cuentas)
- Antes de crear un movimiento, el servidor comprueba que el monedero exista y corresponda al tipo seleccionado (repartidor o comercio).
- Si se vincula un pedido, también verifica que el pedido exista.
- Esto protege la referencia polimórfica `wallet_entries.walletId`, que no puede tener una única clave foránea SQL hacia dos tablas distintas.
- Sigue pendiente implementar cargos automáticos idempotentes y pruebas de integración contra la base de datos real antes de activar cobros en producción.

## Automatización de cargos al completar pedidos

- Pedido de menú a domicilio (`type=delivery`, `fulfillmentMethod=delivery`): al confirmar la entrega con el código del cliente, se crea un cargo confirmado por `serviceFee` en el monedero del repartidor asignado.
- Pedido de menú para retirar (`type=delivery`, `fulfillmentMethod=pickup`): al confirmar el retiro desde el panel del comercio, se crea un cargo confirmado por `serviceFee` en el monedero del comercio.
- Packs de rescate (`type=rescue`): no generan cargo automático de tarifa de servicio.
- El cambio de estado a `delivered` y el movimiento se ejecutan en una misma transacción. La actualización condicional del estado evita que una segunda confirmación registre otro cargo.

La tarifa se toma del valor `serviceFee` guardado en el pedido, no del valor actual de configuración, para respetar el precio que el cliente aceptó al realizarlo.
