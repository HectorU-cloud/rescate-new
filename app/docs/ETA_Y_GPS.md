# GPS mejorado y ETA orientativa

## Qué incluye

- El cliente puede guardar su ubicación actual al crear un pedido a domicilio. Es opcional y requiere permiso del navegador; debe comprobar que coincida con la dirección escrita.
- El pedido guarda `deliveryLat` y `deliveryLng` como columnas opcionales. Los pedidos antiguos siguen funcionando sin coordenadas.
- Cuando hay GPS reciente del repartidor y coordenadas del destino, el backend calcula distancia aproximada y ETA orientativa.
- Si el GPS tiene más de 2 minutos, no se presenta una ETA como actual.
- No se comparte la ubicación del cliente con otros usuarios: solo se utiliza en la consulta autorizada del pedido.

## Limitaciones

La ETA se calcula a partir de distancia geográfica en línea recta, un factor estimado para ruta urbana y una velocidad media fija. No usa tráfico, calles ni rutas reales; puede desviarse bastante y debe mostrarse como aproximación. Para una ETA de producción, integrar un proveedor de rutas (por ejemplo, Google Routes, Mapbox o OSRM) y tratar sus claves/configuración adecuadamente.

El GPS del repartidor funciona mientras su panel web esté abierto, con permiso de ubicación y una conexión activa. No garantiza seguimiento en segundo plano.

## Instalación y prueba

1. Haz una copia de seguridad de MySQL.
2. En `Rescate/app`, instala dependencias con `npm install`.
3. Ejecuta `npm run db:push`. Si Drizzle pregunta por `deliveryLat` y `deliveryLng`, elige crear las columnas nuevas; no renombres columnas existentes.
4. Ejecuta `npm run check` y `npm run build`.
5. En la web, crea un pedido de delivery, escribe la dirección y pulsa **Usar mi ubicación para estimar la llegada**. La ubicación es opcional.
6. Desde el panel del repartidor, acepta el pedido, permite el GPS y deja el panel abierto.
7. Abre el detalle del pedido como cliente. Cuando haya una ubicación reciente, se mostrará la ETA y distancia orientativas.
8. Repite la prueba sin compartir ubicación al crear el pedido: el mapa/GPS sigue disponible, pero la app explicará que no puede calcular la ETA.

## Seguridad y privacidad

- Las coordenadas del destino son opcionales y se guardan en la orden para calcular la ETA.
- La consulta de GPS continúa protegida por los permisos del pedido.
- Evita usar coordenadas de prueba o inventadas para presentar la ETA como real.
