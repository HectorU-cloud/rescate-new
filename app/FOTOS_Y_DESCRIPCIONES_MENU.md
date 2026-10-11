# Fotos y descripciones del menú

## Funcionalidad
- El comercio puede añadir o editar un producto del menú.
- Puede añadir una descripción con ingredientes y posibles alérgenos (hasta 300 caracteres).
- Puede elegir, previsualizar, reemplazar o quitar la fotografía.
- Las imágenes JPG, PNG o WebP se reducen en el navegador a un máximo de 900 px y se comprimen a JPEG.
- Si no existe foto, se conserva el emoji como respaldo.
- Los packs de rescate también admiten foto y se muestran en el panel del negocio, las tarjetas públicas y el detalle del local.

## Aplicar
1. Haz copia de seguridad de la base de datos.
2. Configura `.env` en la carpeta `app`.
3. Ejecuta `npm install`.
4. Ejecuta `npm run db:push` para agregar `rescue_packs.imageUrl`.
5. Ejecuta `npm run check` y `npm run build`.

## Almacenamiento
En esta versión las imágenes comprimidas se guardan en `MEDIUMTEXT` en MySQL. Es apropiado para validar un MVP pequeño, pero para producción con muchos comercios se recomienda migrar a S3/R2. Consulta `IMAGENES_Y_EDICION.md`; esa guía describe la arquitectura y los pasos de migración. El almacenamiento S3/R2 no está activado en esta versión.
