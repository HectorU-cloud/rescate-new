# Rescate: edición de productos, packs y almacenamiento externo de imágenes

## Qué incluye esta versión

- Editar productos existentes: nombre, precio, emoji, descripción/ingredientes y fotografía.
- Publicar packs de rescate con fotografía opcional.
- Optimizar imágenes en el navegador y subirlas directamente a un bucket compatible con S3, sin enviar Base64 al backend ni almacenarlo en MySQL.
- Mantener en MySQL únicamente la URL pública de cada imagen.
- Usar una URL prefirmada de corta duración (5 minutos) creada por el backend después de comprobar que el usuario tiene un negocio registrado.
- Mantener compatibilidad con registros antiguos que todavía guardan una data URL en MySQL.

## Variables de entorno

Configura estas variables en el entorno del backend. Nunca uses prefijos `VITE_` para las claves secretas.

```dotenv
S3_BUCKET=nombre-del-bucket
S3_REGION=auto
S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_URL=https://imagenes.tudominio.com
```

Para **Cloudflare R2**, crea un bucket, genera credenciales S3 limitadas a ese bucket y conecta un dominio público personalizado. `S3_ENDPOINT` debe ser el endpoint S3 de tu cuenta. `S3_PUBLIC_URL` es el dominio público del bucket, sin `/` final. No uses la URL del endpoint S3 como URL de lectura pública.

Para **Amazon S3**, configura `S3_BUCKET`, `S3_REGION`, las credenciales y `S3_PUBLIC_URL` con un dominio/CDN de lectura, como CloudFront. Deja `S3_ENDPOINT` vacío para utilizar el endpoint regional normal de AWS.

Si falta cualquiera de `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` o `S3_PUBLIC_URL`, el backend rechazará nuevas cargas y mostrará un mensaje de configuración. Los productos y packs sin foto seguirán funcionando.

## Configuración CORS del bucket

Añade una regla CORS limitada al dominio real del frontend. Ejemplo orientativo (reemplaza `https://rescate.tudominio.com` por tu dominio):

```json
[
  {
    "AllowedOrigins": ["https://rescate.tudominio.com", "http://localhost:5173"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

En producción elimina `http://localhost:5173` si no lo necesitas. No uses `*` como origen en producción. El navegador hace `PUT` a la URL prefirmada; el bucket/CDN debe permitir la lectura pública de los objetos a través de `S3_PUBLIC_URL`. Mantén las claves privadas solo en el backend y limita sus permisos al bucket necesario.

## Instalación y validación

1. Haz una copia de seguridad de la base de datos y conserva tu proyecto anterior.
2. Descomprime esta versión en una carpeta nueva.
3. Configura `.env` a partir de `.env.example` y añade las variables S3/R2 anteriores.
4. Ejecuta `npm ci` (o `npm install` si no vas a usar el lockfile).
5. Ejecuta `npm run check` y `npm run build`.
6. Ejecuta `npm run dev`, entra con una cuenta que tenga un negocio y prueba subir una foto a un producto y a un pack.
7. Verifica que la URL guardada en MySQL comience por `S3_PUBLIC_URL` y que la imagen abra desde una sesión de cliente.

No se requiere `npm run db:push` para esta integración de almacenamiento: el esquema de productos y packs ya dispone del campo `imageUrl`.

## Qué ocurre con las fotos anteriores

Las imágenes antiguas guardadas como data URL en MySQL seguirán mostrándose. Las nuevas fotos se guardan en S3/R2. Esta entrega no migra automáticamente las imágenes antiguas ni elimina objetos al reemplazar una foto; esa limpieza debe implementarse y verificarse por separado antes de operar con muchos comercios.

## Limitaciones y seguridad

- Las URL prefirmadas duran 5 minutos y solo se generan para usuarios autenticados que tengan un negocio.
- El frontend comprime las imágenes a JPEG antes de cargarlas; el backend firma únicamente los tipos MIME admitidos.
- Configura alertas/límites de uso y revisa el tamaño de los archivos en el proveedor. Para una plataforma pública, añade limitación de frecuencia, inspección adicional de contenido y limpieza de objetos huérfanos.
- `S3_PUBLIC_URL` debe apuntar a un origen público de solo lectura/CDN; nunca debe incluir credenciales.
- Las imágenes subidas previamente no se migran de forma automática.
