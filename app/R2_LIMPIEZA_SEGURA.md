# Limpieza segura de imágenes temporales en Cloudflare R2

## Qué cambia en esta versión

- Las nuevas subidas de productos, packs y fotos de repartidor se cargan bajo `staging/`.
- Al guardar la referencia desde la aplicación, el backend copia la imagen a su carpeta permanente (`businesses/...` o `couriers/...`) y elimina el objeto temporal.
- Las imágenes antiguas y las imágenes ya guardadas siguen usando sus rutas permanentes; no se necesita migrarlas. La regla `staging/` protege las nuevas subidas; no identifica ni elimina automáticamente huérfanos históricos que ya estén en carpetas permanentes.
- Si alguien sube una foto y cierra el formulario sin guardar, queda solo en `staging/` y puede expirar por ciclo de vida.

## Regla de ciclo de vida recomendada

En Cloudflare Dashboard → R2 → tu bucket → Settings → Object lifecycle rules, crea una regla:

- Prefijo del objeto: `staging/`
- Acción: eliminar objetos después de 7 días

No crees una regla para `businesses/`, `couriers/` ni para todo el bucket. Esos prefijos contienen imágenes activas.

## Antes de habilitar en producción

1. Haz respaldo de la base de datos y confirma el bucket correcto.
2. Despliega el backend actualizado y prueba subir/guardar una foto de producto, un pack y una foto de repartidor.
3. Comprueba en R2 que cada objeto guardado está en su prefijo permanente y que desapareció la copia de `staging/`.
4. Sube una foto de prueba y no la guardes; confirma que aparece bajo `staging/`.
5. Solo entonces activa la regla de 7 días. La regla no se debe usar para limpiar imágenes históricas que estén fuera de `staging/`.

La regla de ciclo de vida no elimina instantáneamente objetos: los procesa Cloudflare de forma asíncrona.
