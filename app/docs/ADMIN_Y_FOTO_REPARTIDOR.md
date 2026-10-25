# Rescate: acceso Admin y foto del repartidor

## Cambios incluidos

- La navegación muestra `🛡️ Admin` únicamente cuando la sesión tiene `role === "admin"`. En modo cliente aparece al final de Inicio, Rescate, Pedidos y Perfil; en modo comercio/repartidor se conserva la navegación específica y se agrega Admin al final.
- Perfil muestra una insignia de Administrador para distinguir el rol de seguridad del modo de uso (cliente/comercio/repartidor).
- Cuando la cuenta usa el modo repartidor, Perfil permite cargar foto, vehículo, placa opcional y una presentación.
- La foto se redimensiona a un máximo de 1200 px y se convierte a WebP en el navegador; después se carga directamente a R2/S3 con URL prefirmada de 5 minutos. El backend guarda la URL pública en el perfil cuando se pulsa «Guardar perfil de repartidor».
- Se agrega `/admin/repartidores`, protegida en frontend y backend con el rol `admin`, para aprobar o retirar aprobación de las cuentas que estén en modo repartidor.
- Los endpoints de disponibilidad, aceptación y actualización de GPS rechazan repartidores que aún no estén aprobados.

## Configuración y migración

1. Haz una copia de seguridad de MySQL antes de modificar el esquema.
2. Verifica las variables ya utilizadas por el almacenamiento de imágenes: `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` y `S3_PUBLIC_URL`.
3. En el CORS del bucket R2/S3 permite el origen real de Rescate, método `PUT` y encabezado `Content-Type`. Usa HTTPS en producción.
4. En `app`, ejecuta `npm install` y luego `npm run db:push` para crear las columnas `courierPhotoUrl`, `courierVehicle`, `courierPlate`, `courierBio` y `courierApproved`.
5. Ejecuta `npm run check`, `npm run build` y `npm test`.
6. Reinicia el backend para que use el esquema actualizado.

## Pruebas manuales

1. Inicia sesión con una cuenta administradora y confirma que aparece `🛡️ Admin` al final de la navegación.
2. Abre `/admin/repartidores`; con una cuenta que no sea `admin` no debe mostrarse la página administrativa.
3. Cambia una cuenta de prueba al modo repartidor, abre Perfil y sube una foto JPG/PNG/WebP. Comprueba que el navegador la transforma a WebP, que el `PUT` a R2 responde correctamente y que la foto se muestra tras guardar.
4. Completa vehículo, placa opcional y presentación; guarda y recarga para verificar persistencia.
5. Comprueba que el repartidor pendiente no puede ver/aceptar entregas ni publicar GPS. Desde Admin, aprueba la cuenta y repite la prueba.
6. Retira la aprobación y confirma que los endpoints de disponibilidad, aceptación y GPS vuelven a denegar acceso.
7. Prueba la navegación en escritorio y móvil, y verifica que las otras páginas de catálogo, pedidos, GPS y notificaciones siguen abriendo.

## Notas de seguridad

- No concedas el rol `admin` desde un formulario público; asígnalo solo mediante un proceso seguro de base de datos o administración del backend.
- Aprobar un repartidor es una revisión manual operativa, no una verificación oficial automática de identidad.
- Las URLs prefirmadas expiran en 5 minutos. La carga directa depende de la política CORS y del dominio público configurado en R2/S3.
- La calificación y el número de entregas no se calculan en este cambio; deben conectarse a datos de pedidos/reseñas reales antes de mostrarlos como métricas.
