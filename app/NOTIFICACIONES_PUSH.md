# Notificaciones push en Rescate (Web Push + Firebase Cloud Messaging)

Esta implementación agrega registro y eliminación de tokens por usuario, notificaciones de estado de pedidos y notificaciones en segundo plano para navegadores compatibles. Las notificaciones son opcionales: si Firebase no está configurado, la operación de pedidos continúa funcionando normalmente.

## 1. Configurar Firebase

1. Abre https://console.firebase.google.com/ y crea/selecciona el proyecto de Rescate.
2. En **Configuración del proyecto → General**, registra una aplicación web y copia sus valores de configuración.
3. En **Cloud Messaging**, genera/consulta el certificado Web Push (clave VAPID).
4. En **Configuración del proyecto → Cuentas de servicio**, genera una clave privada para una cuenta de servicio con permisos para enviar mensajes de Firebase Cloud Messaging. Guarda el JSON con cuidado.
5. Activa la API Firebase Cloud Messaging (V1) en Google Cloud si aún no está habilitada.

## 2. Variables de entorno

Copia `.env.example` a `.env` y completa las variables `VITE_FIREBASE_*` con la configuración de la app web y `VITE_FIREBASE_VAPID_KEY` con la clave VAPID pública.

En `FIREBASE_SERVICE_ACCOUNT_JSON`, coloca el contenido completo del JSON de cuenta de servicio como una sola línea. Es una credencial privada del backend: **no** la pongas en variables `VITE_*`, no la subas a Git y no la compartas. En producción, es preferible inyectarla desde el gestor de secretos de tu plataforma.

Las variables `VITE_*` se incorporan al frontend durante el build. Después de cambiarlas, reinicia Vite o vuelve a compilar/re desplegar la aplicación.

## 3. Aplicar el esquema y arrancar

Haz primero una copia de seguridad de MySQL, luego ejecuta:

```bash
npm install
npm run db:push
npm run check
npm run build
npm run dev
```

`db:push` crea la tabla `push_tokens`. En producción, revisa el SQL/esquema y utiliza el proceso de migración habitual antes de aplicarlo.

## 4. Probar

1. Sirve la aplicación desde `localhost` o un dominio HTTPS. Los navegadores no permiten push en HTTP normal.
2. Inicia sesión y abre **Perfil → Activar notificaciones**. Acepta el permiso del navegador.
3. Revisa en MySQL que se haya registrado un token en `push_tokens`.
4. Crea un pedido de prueba y cambia su estado desde el panel del negocio o del repartidor.
5. Prueba tanto con la pestaña abierta como con la app en segundo plano. En algunos navegadores las políticas de ahorro de energía pueden retrasar la entrega.

## 5. Eventos que envían notificaciones

- Al crear un pedido de delivery: confirmación al cliente y aviso de nuevo pedido al comercio.
- Estados `accepted`, `preparing`, `ready`, `picked_up`, `delivered` y `cancelled`: aviso al cliente.
- El endpoint de registro requiere sesión autenticada. Los tokens inválidos que Firebase reporte como no registrados se eliminan automáticamente.

## Notas de seguridad y limitaciones

- Las claves de cuenta de servicio solo pertenecen al backend. No las expongas en el bundle web.
- La configuración web de Firebase y la clave VAPID pública no son secretos privados, pero deben corresponder al proyecto correcto.
- Esta versión cubre notificaciones web push. Las aplicaciones nativas Android/iOS deberán registrar sus tokens a través de sus respectivos clientes y usar el mismo endpoint de registro, con `platform` apropiado.
- El envío de push es best-effort: un fallo de Firebase se registra en logs y no revierte el cambio de estado del pedido.
- Las notificaciones push no sustituyen el refresco de datos de la app ni son garantía de entrega instantánea.
