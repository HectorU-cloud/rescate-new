# Ciudades: ubicación al entrar y catálogo por ciudad

La primera vez que alguien entra a Inicio o a Rescates, la app le pregunta en qué ciudad está.
Desde entonces solo ve los locales y rescates de esa ciudad. Puede cambiarla en cualquier momento
tocando el botón con la ciudad (arriba, en el encabezado verde/naranja).

## Qué ve la persona
| Opción | Qué pasa |
| --- | --- |
| **Usar mi ubicación** | Pide el permiso del navegador, detecta la ciudad y la fija. |
| **Elegir mi ciudad** | Lista de ciudades con la cantidad de locales de cada una ("Próximamente" si aún no hay). |
| **Ahora no, ver todas** (o cerrar el diálogo) | Se muestran todas las ciudades, como antes, y no se vuelve a preguntar. |

Si el permiso está bloqueado, el GPS falla, o la persona está fuera de nuestras zonas, se muestra el motivo
y la lista de ciudades para elegir a mano. Si la ciudad elegida aún no tiene locales, se ofrece "Ver todas las ciudades".

## Privacidad
- La ubicación del GPS se compara con la lista de ciudades **en el dispositivo**. No se envía al servidor ni se guarda.
- Lo único que se recuerda (en el `localStorage` del dispositivo, clave `rescate-city`) es el **id de la ciudad**.
- Al servidor solo viaja el id de la ciudad como filtro (`cityId`).
- La política de privacidad (`/privacidad`, sección 4) ya lo explica.

## Cómo se decide la ciudad
- **De una persona:** su GPS cuenta como "estoy en X" solo si está dentro del `radiusKm` de la ciudad más cercana.
- **De un local:** siempre la ciudad más cercana a su pin. No hay columna nueva en la base de datos: si el dueño mueve el pin, el local cambia de ciudad solo.

## Cómo agregar una ciudad
Una línea en `contracts/cities.ts`:

```ts
{ id: "el-triunfo", name: "El Triunfo", lat: -2.3, lng: -79.3, radiusKm: 8 },
```
- `id`: minúsculas y sin espacios (se guarda en el dispositivo; no lo cambies después).
- Las coordenadas son el **centro aproximado**: confírmalas en Google Maps.
- Mantén los centros a más de 5 km entre sí (hay una prueba que lo exige).
- **La zona de servicio es el radio de 40 km alrededor de Milagro MÁS el área de cada ciudad de la lista**
  (`isInServiceArea` en `contracts/geo.ts`). Así una ciudad en el borde del radio —como Babahoyo, a ~37,6 km, cuyo norte
  pasa de los 40 km— se puede usar completa, y agregar una ciudad basta para que sus locales puedan registrarse.

## Qué se filtra y qué no
- **Sí se filtra:** `catalog.businesses` (lista de Inicio) y `catalog.rescuePacks` (Inicio y Rescates).
- **No se filtra:** el detalle de un local (los enlaces directos siguen funcionando), los pedidos ni la tarifa de entrega (siguen dependiendo de la distancia real).
- Sin `cityId`, o con uno que ya no existe en la lista, no se filtra nada.
- `catalog.cityCounts` devuelve cuántos locales visibles hay por ciudad (para el selector).
- El mapa donde se marca una dirección o un local abre centrado en la ciudad elegida.

## Repartidores: solo ven y reciben pedidos de su ciudad
Cada repartidor tiene una **ciudad de trabajo** (`users.courierCityId`, solo el id de la ciudad). Se elige con el botón de
ciudad de su panel (al entrar por primera vez se le pregunta; no se puede saltar ni elegir "todas").

| Qué | Regla |
| --- | --- |
| Tablero "Pedidos disponibles" | Solo pedidos cuyo **local** (donde se recoge) está en su ciudad. Sin ciudad elegida, ninguno. |
| Tomar un pedido (`courier.accept`) | Rechazado si es de otra ciudad (aunque conozca el id): "Este pedido es de Babahoyo. Cambia tu ciudad de trabajo…". |
| Avisos push de "pedido listo" y recordatorios | Solo a los repartidores disponibles **de la ciudad del local**. |
| Entregas que ya lleva | No se esconden si cambia de ciudad. |
| Cambio automático | Al abrir el panel, **solo si ya había concedido el permiso de ubicación**, la ciudad se actualiza sola (p. ej. si viajó). Nunca se lanza el permiso por su cuenta. |

**Puesta en marcha:** ejecuta `db/manual/2026-11-courier-city.sql` (o `npm run db:push` en desarrollo). Los repartidores
existentes quedan sin ciudad y no ven pedidos hasta elegirla la próxima vez que abran su panel: **avísales**.

## Panel de admin
- **Resumen → "Por ciudad":** para cada ciudad, cuántos pedidos están esperando repartidor y cuántos repartidores conectados
  trabajan allí. Si hay pedidos esperando y ningún repartidor, la fila se marca en rojo ("⚠️ sin cobertura").
- Un aviso ámbar cuenta a los repartidores aprobados que **aún no eligieron ciudad** (no ven pedidos hasta elegirla).
  Después de ejecutar el SQL de `courierCityId`, todos los repartidores existentes aparecerán ahí hasta que abran su panel.
- **Finanzas → lista de cuentas:** cada repartidor y cada local muestra su ciudad ("sin ciudad" si el repartidor no eligió).
  La ciudad de un local sale de su pin en el mapa.

## Pendiente (ideas)
- Que el admin pueda cambiar la ciudad de un repartidor.
- Si una ciudad crece mucho (p. ej. Guayaquil), un solo punto central no basta para asignar bien los locales de sus bordes.
  Entonces convendría una columna `cityId` en `businesses` que el admin pueda corregir.
- Mostrar locales de ciudades cercanas ("Incluir Yaguachi").
