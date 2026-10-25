# Rescate — GPS mejorado y tiempo estimado de llegada

Esta versión parte del ZIP **Rescate-admin-foto-repartidor** e incluye sus funciones anteriores (perfil y aprobación de repartidores, navegación Admin, subida de foto a R2/S3, autenticación, catálogo y notificaciones), además de una ETA orientativa.

## Cambios incluidos

- El checkout permite al cliente compartir opcionalmente su ubicación actual para calcular la llegada.
- Se guardan las coordenadas opcionales `deliveryLat` y `deliveryLng` en cada pedido de delivery.
- El endpoint autorizado de ubicación calcula distancia y ETA solo si el GPS del repartidor está actualizado y el pedido tiene coordenadas de destino.
- Si el cliente no comparte coordenadas, el mapa y el GPS siguen funcionando; se explica por qué no puede calcularse la ETA.
- Se conserva el cambio de cierre de sesión en `src/hooks/useAuth.ts`: redirige al login tanto si el endpoint responde correctamente como si falla.
- Se eliminó `ignoreDeprecations: "6.0"` del `tsconfig.app.json`, ya que no es compatible con TypeScript 5.9 fijado por el proyecto.

## Importante sobre la ETA

La ETA es orientativa: usa distancia geográfica, un factor aproximado para calles urbanas y una velocidad media fija. No consulta tráfico ni calcula rutas reales. No debe presentarse como una promesa de llegada. Para producción, se recomienda integrar un servicio de rutas.

## Instalación

1. Descomprime el ZIP en una carpeta nueva y conserva tu versión anterior como respaldo.
2. Entra en `Rescate/app`.
3. Copia la configuración de tu `.env` local (no la subas a GitHub ni la compartas).
4. Haz una copia de seguridad de MySQL.
5. Ejecuta:

```bash
npm install
npm run db:push
npm run check
npm run build
npm test
npm run dev
```

6. Si Drizzle pregunta por `deliveryLat` y `deliveryLng`, selecciona **crear columnas nuevas**. No renombres columnas existentes.
7. Si aparece una pregunta de migración distinta, detente y revisa antes de aceptar.

## Prueba manual

1. Inicia sesión como cliente y añade productos al carrito.
2. Escribe la dirección de entrega.
3. Pulsa **Usar mi ubicación para estimar la llegada** y permite el acceso del navegador. Confirma que la ubicación corresponda a la dirección.
4. Confirma el pedido.
5. Inicia sesión como repartidor aprobado, acepta el pedido y deja abierto el panel con permiso GPS.
6. Desde la cuenta del cliente abre el detalle del pedido. Con una posición GPS reciente debe aparecer la distancia y la ETA aproximada.
7. Repite sin compartir la ubicación del cliente: la ETA no se debe inventar; se muestra un aviso explicativo.
8. Deja de compartir GPS o espera a que la ubicación quede antigua: la interfaz no debe mostrarla como actual.

## Privacidad y límites

- Compartir la ubicación del cliente es opcional.
- El backend solo entrega la ubicación del pedido a participantes autorizados.
- El seguimiento del repartidor en la web requiere que el navegador esté abierto, tenga permiso de geolocalización y conexión. No garantiza seguimiento en segundo plano.
- No se guardan rutas históricas: se mantiene la última ubicación por pedido activo y se elimina al completar la entrega.

## Validación realizada en este entorno

- TypeScript: `tsc -b` completó correctamente con las dependencias disponibles.
- Build y Vitest: no se pudieron completar aquí porque falta el paquete opcional nativo `@rollup/rollup-linux-x64-gnu` en el entorno Linux. En Windows, ejecuta `npm install` para que npm instale el binario apropiado y vuelve a ejecutar las comprobaciones.
