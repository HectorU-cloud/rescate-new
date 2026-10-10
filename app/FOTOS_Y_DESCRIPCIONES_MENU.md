# Fotos y descripciones del menú

## Funcionalidad
- El comercio puede seleccionar una foto JPG, PNG o WebP al crear un producto.
- El navegador reduce la imagen a un máximo de 900 px y la comprime antes de enviarla.
- Se puede añadir una descripción de hasta 300 caracteres con ingredientes y alérgenos.
- La foto y la descripción aparecen en la lista del menú que ve el cliente.
- La foto es opcional; si no se carga, se conserva el emoji de respaldo.

## Aplicar el cambio
1. Haz copia de seguridad de la base de datos.
2. En la carpeta `app`, configura el `.env` de desarrollo.
3. Ejecuta `npm install` si es necesario.
4. Ejecuta `npm run db:push` para añadir `products.imageUrl`.
5. Ejecuta `npm run check` y `npm run build`.

## Nota de arquitectura
Para que esta primera versión funcione sin configurar un proveedor externo, la imagen optimizada se guarda como data URL en una columna `MEDIUMTEXT`. Es apropiado para probar un MVP con pocas fotos, pero aumenta el tamaño de la base de datos y de las respuestas del catálogo. Antes de producción con muchos comercios, se recomienda migrar a almacenamiento de objetos (S3 compatible) y guardar en MySQL solo la URL pública o firmada. No se debe guardar la imagen original sin comprimir.
