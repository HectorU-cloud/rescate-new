# Publicar Rescate en Google Play (como TWA)

Rescate es una web (React en Vercel + API en Railway). La forma más corta de llevarla a Google Play es una **TWA** (Trusted Web Activity): una app Android que abre tu sitio en Chrome a pantalla completa, sin barra de direcciones. No reescribe nada del código.

## Qué incluye este cambio
- `public/manifest.webmanifest` e iconos en `public/icons/` (192, 512 y "maskable"), más `favicon.ico`. **Los iconos son provisionales** (fondo verde con «AR»): reemplázalos con tu logo conservando nombres y tamaños. El maskable debe llevar el logo dentro del 60 % central para que Android no lo recorte.
- Enlaces en `index.html` y cabeceras en `vercel.json` para el manifiesto y `assetlinks.json`.
- Página pública `/eliminar-cuenta` (Google Play exige una URL pública con los pasos para borrar la cuenta, además del botón dentro de la app) y enlace desde la política de privacidad.
- `docs/assetlinks.example.json`: plantilla del archivo que enlaza tu sitio con la app Android.

**No incluye** service worker de caché ni modo sin conexión: lo evité a propósito, porque cachear mal pedidos o precios es peor que no tener offline. El único service worker del proyecto es el de Firebase (notificaciones), que se registra al activarlas.

## Antes de empezar
1. **Dominio propio** para el frontend (no `*.vercel.app`), con HTTPS. El `package id` y los enlaces dependen de él.
2. Configura `VITE_PRIVACY_EMAIL` (y `VITE_LEGAL_NAME`) en Vercel y vuelve a desplegar. Si está vacío, la política dice «el correo de contacto del servicio», y Play necesita un contacto real.
3. Despliega este cambio y comprueba en el navegador que abren `/manifest.webmanifest`, `/eliminar-cuenta` y `/privacidad` sin iniciar sesión.
4. Corre Lighthouse (Chrome DevTools → Lighthouse → «Progressive Web App/Installability») o PWABuilder sobre tu dominio. Si te pide un service worker para poder instalarse, avísame y lo añadimos con un `fetch` mínimo que no cachee `/api`.

## Generar la app (Bubblewrap)
```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest=https://TU-DOMINIO/manifest.webmanifest
bubblewrap build        # genera app-release-bundle.aab (el que se sube a Play)
```
- Necesita JDK y Android SDK; Bubblewrap ofrece descargarlos.
- **El package id (por ejemplo `ec.alrescate.app`) no se puede cambiar después de publicar.** Elígelo con cuidado.
- Guarda el keystore y sus contraseñas en un lugar seguro y con copia. Con Play App Signing, el keystore que generas es solo la clave de *subida*.

## Digital Asset Links
1. En Play Console, con la app creada: **Configuración → Integridad de la aplicación → firma de apps**, y copia la huella **SHA-256 del certificado de firma de la app** (la que usa Google, no la de subida).
2. Copia `docs/assetlinks.example.json` a `public/.well-known/assetlinks.json` y rellena `package_name` y la huella. Puedes añadir también la huella de la clave de subida para probar builds locales.
3. Despliega y abre `https://TU-DOMINIO/.well-known/assetlinks.json`: debe responder JSON, sin redirecciones.
4. Si falla, la app abre el sitio con una barra de Chrome arriba: es la señal de que el enlace no se verificó.

## Ficha de Google Play (todo esto verifícalo en la ayuda de Play Console; las reglas cambian)
- **Política de privacidad:** `https://TU-DOMINIO/privacidad`.
- **Eliminación de cuenta:** `https://TU-DOMINIO/eliminar-cuenta` (y el botón en Perfil → «Eliminar mi cuenta»).
- **Seguridad de los datos (borrador a partir de tu política; compruébalo tú):** recopilas nombre, correo, teléfono, direcciones y ubicación (precisa, también la del repartidor con pedido activo), fotos, mensajes, identificadores de dispositivo (push) y dirección IP. Se comparten con proveedores que prestan el servicio (Firebase, Sentry, Resend, almacenamiento de imágenes, hosting). Los datos viajan por HTTPS y el usuario puede pedir su borrado.
- **Permisos:** ubicación (la web la pide en el navegador), cámara si el repartidor sube foto, notificaciones.
- **Clasificación de contenido y público objetivo:** tu política dice que el servicio es para mayores de 18 años; sé coherente en los cuestionarios.
- **Capturas de pantalla** (mínimo 2) y gráfico de funciones (1024×500): tendrás que prepararlos.

## Pruebas obligatorias antes de producción
Si tu cuenta de desarrollador es **personal y se creó después del 13 de noviembre de 2023**, Google exige una prueba cerrada con **al menos 12 testers inscritos de forma continua durante 14 días** antes de pedir acceso a producción. Las cuentas de organización están exentas, pero necesitan número D-U-N-S. Confirma el requisito actual en la ayuda de Play Console («Requisitos de prueba para cuentas personales nuevas»).

Mientras tanto, usa la pista de **prueba interna** para tus primeras instalaciones: no tiene mínimo de testers, pero no cuenta para el requisito.

## Cosas que probar en un teléfono Android real (dentro de la TWA)
- **Login con Google:** una TWA usa Chrome, no un WebView, así que debería funcionar; compruébalo de punta a punta.
- **GPS del repartidor:** la ubicación solo se envía **con la app abierta**; una TWA no puede seguir en segundo plano. Si tu operación necesita seguimiento con el teléfono bloqueado, hará falta una app nativa o un servicio en primer plano.
- **Notificaciones push:** prueba que llegan y que al tocarlas se abre el pedido correcto.
- **Cámara y subida de fotos** del repartidor y de los productos.

## Antes de tener usuarios reales
- **Google Cloud → pantalla de consentimiento de OAuth:** pásala de «Testing» a «En producción» (con tus datos de contacto y política de privacidad). Revisa si Google te pide verificación.
- **Migraciones de base de datos (pendiente, no incluido):** hoy el proyecto aplica el esquema con `db:push` y solo hay una migración (`0000`) que ya no refleja el esquema actual. Antes de abrir al público conviene crear una línea base de migraciones versionadas y tener copias de seguridad automáticas de MySQL. Hazlo en tu máquina, con tu base y tu versión de `drizzle-kit`, y con copia previa; no lo automaticé aquí porque un error en la tabla de migraciones de producción es difícil de revertir.
- **Revisión legal:** términos y privacidad deberían pasar por un abogado (LOPDP).
