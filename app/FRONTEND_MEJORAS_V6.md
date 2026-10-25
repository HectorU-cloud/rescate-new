# Al Rescate — mejoras frontend V6

## Cambios incluidos
- Se renovó la página **Mis pedidos** con encabezado visual, contadores de pedidos en curso y finalizados, y secciones más claras.
- Se añadieron estados de carga, error con reintento y estado vacío más útil.
- Cada pedido muestra el estado en una etiqueta visual, el código, el tipo, la antigüedad, el total y un acceso claro al detalle.
- Las tarjetas y métricas se adaptan mejor a pantallas pequeñas y tienen foco visible para navegación por teclado.
- En el panel del repartidor, las métricas de ganancias ahora pueden acomodarse en varias líneas en móviles estrechos.
- Se conservaron las consultas, rutas y acciones existentes; no se modificó la lógica del servidor.

## Verificación
Esta entrega contiene cambios de interfaz. No se declara compilación verificada: antes de publicar, ejecutar `npm ci`, `npm run check`, `npm run lint` y `npm run build` desde la carpeta `app`.
