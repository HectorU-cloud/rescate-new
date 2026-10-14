# Mejoras de comercio: prioridad de locales abiertos y reseñas

## Cambios incluidos

- El catálogo ordena primero los comercios abiertos en este momento; dentro de abiertos/cerrados conserva el orden por calificación descendente.
- Nuevo procedimiento `business.reviews`: devuelve las últimas 100 reseñas del comercio autenticado, con nombre público del cliente, estrellas, comentario y fecha. La consulta obtiene el comercio mediante `requireMyBusiness`, por lo que no permite elegir el ID de otro comercio.
- Nueva pestaña **⭐ Reseñas** en el panel del negocio, con estados de carga, error y lista vacía.

## Cómo validar

1. Inicia sesión como cliente y comprueba que un local abierto aparezca antes que uno cerrado, aunque este último tenga más estrellas.
2. Inicia sesión como dueño de un comercio que tenga calificaciones y abre `Panel del comercio > Reseñas`.
3. Verifica estrellas, comentario y fecha; una calificación sin comentario debe mostrar un texto indicativo.
4. Inicia sesión con otro comercio y comprueba que no vea las reseñas del primero.
5. Ejecuta `npm run check`, `npm test` y `npm run build`.

No se necesita migración de base de datos: se usan las tablas y columnas existentes.
