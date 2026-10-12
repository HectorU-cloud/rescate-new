# Autenticación de Al Rescate

Esta versión conserva OAuth con Google y añade registro con correo/contraseña, verificación por correo y recuperación de contraseña.

## Configuración requerida

1. Haz una copia de seguridad de MySQL.
2. Configura `APP_URL` con la URL pública HTTPS de la aplicación, sin `/` final.
3. Configura `RESEND_API_KEY` y `AUTH_EMAIL_FROM`. El remitente debe estar verificado en Resend; no uses `noreply@example.com` en producción.
4. Conserva configuradas las variables existentes de Google OAuth, MySQL y `APP_SECRET`.
5. Instala dependencias y ejecuta `npm run db:push`, `npm run check`, `npm run build` y `npm run dev`.

El registro usa Resend para mandar un enlace de verificación con expiración de una hora. La recuperación de contraseña también usa un token aleatorio almacenado como hash y vence en una hora. El backend responde igual si un correo de recuperación existe o no para reducir la enumeración de cuentas.

## Pruebas manuales

- Registrar una cuenta con nombre, correo y contraseña de 10 a 128 caracteres.
- Confirmar que llega el correo de verificación y que el enlace activa la cuenta.
- Intentar iniciar sesión antes de verificar: debe rechazarse.
- Iniciar sesión con el correo verificado y comprobar que navega a `/`.
- Solicitar recuperación y comprobar que llega un enlace de un solo uso.
- Usar el enlace para establecer una contraseña nueva e iniciar sesión con ella.
- Probar una contraseña incorrecta y confirmar que el mensaje no revela si existe el correo.
- Probar Google OAuth para asegurar que continúa funcionando.
- Probar `/api/dev-login` en desarrollo con `DEV_LOGIN=true` y comprobar que en producción devuelve 404 incluso si la variable está configurada como true.
- Verificar que una cuenta registrada por email no recibe rol admin; el registro fuerza `role: user`. La asignación de roles de comercio/repartidor debe seguir un flujo autorizado y no debe aceptar roles arbitrarios desde el cliente.

## Entorno de desarrollo frente a producción

`/api/dev-login` se registra únicamente cuando `DEV_LOGIN=true` y `NODE_ENV` no es `production`. En producción el endpoint no se monta. No basta con ocultar el botón del frontend: el bloqueo del backend es el control importante.

## Seguridad y límites conocidos

- Las contraseñas se guardan con scrypt y salt aleatorio; los tokens de verificación/recuperación se guardan como SHA-256.
- Los tokens caducan tras una hora y se eliminan al usarse.
- Configura HTTPS en producción y protege las claves de Resend/Google/APP_SECRET; no las subas a Git.
- Se añadió limitación por IP y ventana temporal en el proceso: login 10/15 min, registro 5/hora, verificación 30/15 min, recuperación 5/hora y cambio de contraseña 10/15 min. Al exceder el límite responde HTTP 429 con `Retry-After`. El contador está en memoria y se reinicia al reiniciar el servidor; en despliegues con varias instancias debes añadir un limitador compartido en CDN/proxy o Redis. El proxy debe reemplazar `X-Forwarded-For`; no confíes en ese encabezado si el servidor es accesible directamente desde internet.
- Las solicitudes de correo requieren que Resend esté configurado. Sin `RESEND_API_KEY`, registro y recuperación devolverán un error del servidor.
- Haz backup antes de `npm run db:push`: agrega `passwordHash`, `emailVerifiedAt` a `users` y crea `auth_tokens`.


## Limitación de intentos añadida

El middleware `api/lib/rate-limit.ts` protege las rutas sensibles de autenticación con límites temporales por IP. Esta protección es una capa básica para un único proceso, no sustituye un WAF/CDN ni un limitador compartido en producción. Si ejecutas varias réplicas, configura rate limiting en el proxy o Redis.

## Pruebas adicionales de seguridad

- Enviar 11 intentos de login desde la misma IP en menos de 15 minutos: el intento 11 debe recibir `429` y `Retry-After`.
- Enviar 6 solicitudes de registro desde la misma IP dentro de una hora: la sexta debe recibir `429`.
- Repetir para recuperación y comprobar el límite de 5 por hora.
- Confirmar que una cuenta normal no puede modificar su `role` o `appRole` enviando campos extra al endpoint de registro.
- En producción, confirmar que `GET /api/dev-login` devuelve `404`, incluso con `DEV_LOGIN=true` en el entorno.
