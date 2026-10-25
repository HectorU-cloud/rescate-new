# Al Rescate — mejoras de interfaz

## Cambios de esta versión
- Rediseño de la pantalla de inicio con una cabecera verde, búsqueda destacada y acceso a rescates.
- Categorías en formato de chips/tarjetas con selección visible.
- Bloque de rescates con ahorro, disponibilidad y prioridad visual para locales abiertos.
- Orden visual de locales abiertos antes que cerrados en la pantalla de inicio.
- Tarjetas de comercio renovadas con estado de apertura, valoración, tiempo estimado y tarifa de envío.
- Ajustes de ancho y espaciado general para escritorio y móvil.
- Eliminados estilos de demostración de Vite que afectaban el centrado y padding global.

## Importante
Esta actualización se centra en la presentación del frontend y mantiene las rutas y consultas existentes. La comprobación TypeScript no pudo completarse en este entorno porque faltan definiciones de tipos de Node/Vite dentro de `node_modules`; ejecutar `npm ci` en un entorno con acceso al registro y después `npm run check` y `npm run build` antes de desplegar.
