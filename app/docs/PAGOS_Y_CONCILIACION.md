# Pagos y conciliación (04)

## Qué incluye
- **Reporte de pago con comprobante.** Repartidores y comercios reportan un pago desde su estado de cuenta: importe, referencia y foto del comprobante. Queda **por verificar** y no reduce el saldo hasta que un admin lo confirme.
- **Revisión del admin con el comprobante a la vista.** En Finanzas → "Pagos pendientes de revisión" se ve la foto (se abre completa en otra pestaña), la referencia, cuánto debe la cuenta, y los botones Confirmar / Rechazar. Rechazar exige un motivo, que la persona ve en su estado de cuenta. Quien reportó recibe aviso (push y campana) al confirmarse o rechazarse.
- **Cómo pagar.** El admin escribe en Finanzas → Configuración las instrucciones de pago (banco, cuenta, titular); se muestran al repartidor o comercio que debe.
- **Reporte por período.** Finanzas → "Reporte por período": saldo inicial, cargos, pagos confirmados, ajustes, saldo final y pagos por verificar de cada local y repartidor, con totales y descarga en CSV.
- **Liquidaciones.** "Generar liquidaciones del período" guarda la constancia del estado de cuenta de cada cuenta con movimientos. Cada persona ve las suyas en su estado de cuenta.

## Reglas
- Un pago cuenta en el período en que el admin lo **confirma** (no cuando se reportó). Así, un período ya liquidado no cambia después.
- Fechas en hora de Ecuador (UTC-5), ambas incluidas. Máximo 366 días por período.
- Solo se liquidan períodos **ya terminados**. Es idempotente: si ya existe la liquidación de una cuenta para ese período exacto, se omite. Una liquidación no se edita.
- Una liquidación es una **constancia** del estado de cuenta: no modifica movimientos ni saldos.
- Antifraude básico al reportar: misma referencia (sin distinguir mayúsculas) o mismo comprobante no se aceptan dos veces, ni entre cuentas distintas; máximo 5 pagos por verificar por cuenta; la foto debe ser una que subió esa misma cuenta.

## Flujo de la imagen del comprobante
Igual que las demás fotos: la app la comprime a WebP (máx. 1600 px), pide una URL firmada de 5 minutos (`wallet.createProofUpload`), sube directo a `staging/payments/<courier|business>/<id>/proof/`, y al enviar el reporte (`wallet.reportPayment`) el backend la copia a `payments/<tipo>/<id>/proof/` y borra la temporal. Las subidas no enviadas expiran con la regla de ciclo de vida de `staging/`.

> **Privacidad:** los comprobantes pueden mostrar nombres y números de cuenta. Hoy las imágenes se sirven por la URL pública del bucket (nombres aleatorios de 24 caracteres, imposibles de adivinar, pero accesibles a quien tenga el enlace). La app solo entrega la URL al admin. Si quieres un nivel más estricto, usa un bucket privado para `payments/` y entrega al admin URLs firmadas de lectura.

## Base de datos
Cambios en el esquema: columna `wallet_entries.reviewNote`, columna `finance_settings.paymentInstructions` y tabla nueva `settlements` (índice único por cuenta y período). Haz una copia de seguridad, revisa el SQL que propone Drizzle y ejecuta:

```bash
npm run db:push
npm run check
npm test
npm run build
```

## Pruebas
- Unitarias (sin base de datos): `server/lib/settlement-rules.test.ts` (períodos, estados de cuenta, bordes) y `src/lib/csv.test.ts`.
- Integración (MySQL de pruebas + almacenamiento falso): `server/payments.integration.test.ts`.
