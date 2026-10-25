# Al Rescate — mejoras frontend V7

## Perfil y confianza del repartidor
- Se reorganizó la pantalla de cuenta con una cabecera más clara y un ancho más cómodo en escritorio.
- Se mejoró la sección de perfil del repartidor para explicar qué datos ayudan al cliente a reconocerlo.
- El botón de fotografía ahora cambia según el estado y conserva indicaciones de formatos admitidos.
- Se añadió una vista previa en vivo del perfil público con foto, nombre, vehículo, placa y presentación.
- Se muestra el contador de caracteres de la presentación y se normaliza la placa a mayúsculas al guardar.
- Se reforzaron estados de foco, carga y deshabilitado en controles principales.
- Se añadieron iconos a secciones de cuenta, teléfono, notificaciones y modo de la app.

## Compatibilidad
- Se mantuvieron las mutaciones, consultas tRPC, autenticación, roles y carga de fotografías existentes.
- No se cambió la lógica de pedidos ni se añadió lógica de notificaciones.

## Validación
- La instalación de dependencias no terminó dentro del tiempo disponible, por lo que no se pudo ejecutar `npm run check`, `npm run build` ni las pruebas. Revisar con esas órdenes antes de desplegar.
