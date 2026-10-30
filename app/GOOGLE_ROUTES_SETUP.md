# Google Maps Routes API — Rescate

## Configuración en Google Cloud
1. Selecciona o crea un proyecto.
2. Habilita **Routes API**.
3. Configura facturación y cuotas para controlar el consumo.
4. Crea una API key restringida a Routes API. No la publiques en el frontend.

## Variables de entorno del backend
Configura en Railway/Render o en el entorno local:

```env
GOOGLE_ROUTES_ENABLED=false
GOOGLE_ROUTES_API_KEY=
GOOGLE_ROUTES_TRAFFIC_AWARE=true
GOOGLE_ROUTES_TIMEOUT_MS=4500
```

Primero deja `GOOGLE_ROUTES_ENABLED=false`. Cuando la clave esté lista, agrega el valor en el servidor, cambia a `true` y reinicia el backend. La clave no debe llevar prefijo `VITE_`.

## Migración
Ejecuta una sola vez `db/migrations/0002_google_routes_metadata.sql` contra la base de datos de Rescate. Si gestionas el esquema mediante migraciones automatizadas, incorpórala a ese pipeline y no la ejecutes dos veces.

Las columnas son nullable para conservar pedidos históricos: `deliveryDurationMinutes` y `deliveryRouteProvider` (`google` o `fallback`).

## Comportamiento
- Deshabilitado, sin clave, error HTTP, respuesta incompleta o timeout: usa el cálculo aproximado existente (`fallback`).
- Respuesta válida: usa distancia y duración de Google (`google`).
- El servidor recalcula el importe al crear el pedido; no confía en precios enviados por el navegador.
- Se guardan distancia, duración y proveedor en el pedido. La ETA de Google no incluye preparación del comercio.
- Se usa `DRIVE` como modo de transporte para compatibilidad general.
