# Foto o logo del local, validación de campos y recuadro del envío

## 1. Foto o logo del local (en lugar del emoji)
- El dueño puede subir una foto o logo **al registrar el local** (se sube justo después de crearlo) y **cambiarla o quitarla después** desde el panel del comercio (tarjeta «Foto o logo del local»).
- Se muestra en las tarjetas de la portada, en la cabecera del local y en el encabezado del pedido. Si no hay foto, se sigue usando el emoji.
- Usa el mismo almacenamiento que las fotos de productos (S3/R2, ver `IMAGENES_Y_EDICION.md`): la imagen se optimiza en el navegador y se sube con URL prefirmada; el servidor solo guarda la URL y solo acepta imágenes subidas por ese dueño. Si el almacenamiento no está configurado, el local se registra igual y avisa que la foto no se pudo subir.
- **Cambio de base de datos obligatorio:** nueva columna `businesses.imageUrl`. En producción ejecuta una sola vez `db/manual/2026-11-business-image.sql` (o aplica el esquema con tu flujo habitual) **antes** de desplegar este código; si no, las consultas de locales fallarán. Verifica con `npm run db:check-schema`.
- Pendiente a propósito: no hay moderación de la imagen (el local ya pasa por aprobación al registrarse, pero cambiar la foto después no la requiere). Si lo necesitas, se puede pedir revisión del admin al cambiarla.

## 2. Validación de campos
- **Carrito:** dirección (mínimo 5 caracteres), ubicación y celular son obligatorios para domicilio; el celular también para retiro. Los errores salen junto a cada campo en rojo, el botón ya no se desactiva en silencio y, al confirmar con errores, lleva al primer campo con problema. El celular se acepta como `0991234567`, `099 123 4567` o `+593 99 123 4567` y se guarda como `0991234567`.
- **Registro del local:** nombre, dirección, teléfono, tarifas, tiempos, horario y ubicación en el mapa, con mensajes claros y marca `*` en los obligatorios. El teléfono admite celular o convencional (`042123456`). Se agregó el campo de teléfono, que antes no se podía llenar.
- **Servidor:** también valida el formato del celular del pedido y el teléfono del local (no solo el navegador). Todavía **no** exige que haya celular si no se envía ninguno (usa el del perfil, si existe) para no romper las pruebas existentes; se puede exigir cuando puedas correr la suite completa.

## 3. Recuadro del envío
- «Tiempo estimado de viaje» ahora aparece **arriba del subtotal**.
- El desglose («Cómo se calcula el envío») solo muestra la fila de tiempo cuando el tiempo suma al precio, para no mostrar «$0.00» sin sentido.
- Es el tiempo de ruta del repartidor; no incluye la preparación del pedido en el local.

## Pruebas nuevas
`server/lib/phone.test.ts` (validadores) y dos casos en `server/pricing.integration.test.ts` (celular del pedido y teléfono del local; requieren `TEST_DATABASE_URL`).
