# Al Rescate

Plataforma de delivery + **packs de rescate** de comida (descuento al cierre del día) para comercios de Milagro, Ecuador.
Roles: cliente, comercio y repartidor.

**Stack:** React 19 · Vite · Tailwind + shadcn/ui · Hono · tRPC · Drizzle ORM · MySQL · Login con Google (OAuth 2.0)

## Correr en local

Requisitos: Node 20+ y **MySQL 8**. MariaDB no es compatible con el esquema (Drizzle genera `serial AUTO_INCREMENT`, que MariaDB rechaza).

```bash
npm install
cp .env.example .env          # y completa los valores (ver abajo)
docker run -d --name mysql-rescate -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=alrescate -p 3306:3306 mysql:8
npm run db:push               # crea las tablas
npx tsx db/seed.ts            # datos demo: 7 comercios y 4 packs
npm run dev                   # http://localhost:3000
```

Mínimo para desarrollo sin Google:

```
APP_SECRET=<openssl rand -hex 32>
DATABASE_URL=mysql://root:root@localhost:3306/alrescate
DEV_LOGIN=true
OWNER_EMAIL=tu-correo@gmail.com
```

Con `DEV_LOGIN=true` la pantalla de login muestra "Entrar como usuario de prueba".
Para probar varios roles a la vez: `/api/dev-login?as=cliente`, `?as=comercio`, `?as=repartidor`.

## Login con Google

1. https://console.cloud.google.com/apis/credentials → **Crear credenciales → ID de cliente de OAuth → Aplicación web**.
2. **URIs de redireccionamiento autorizados** (deben coincidir exactamente):
   - `http://localhost:3000/api/oauth/google/callback`
   - `https://TU-DOMINIO/api/oauth/google/callback`
3. En la pantalla de consentimiento agrega tu correo como usuario de prueba mientras esté en modo "Testing".
4. Copia `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` al `.env` (nunca al repositorio).

## Producción

```bash
npm run build && NODE_ENV=production npm start
```

En producción `APP_SECRET`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `APP_URL` son obligatorios y la app debe servirse por **HTTPS** (la cookie de sesión es `Secure`).


## Funciones recientes

- GPS de repartidor: consulta `GPS_EN_VIVO.md`.
- Fotografías, edición de productos y almacenamiento S3/R2: consulta `IMAGENES_Y_EDICION.md`.
- Notificaciones push web con Firebase Cloud Messaging: consulta `NOTIFICACIONES_PUSH.md`.

## Actualizar una base de datos que ya tiene usuarios (correo único)

El correo de `users` ahora es único. Si la tabla ya tiene datos, `drizzle-kit push` pregunta
**«¿Quieres truncar la tabla users?»**: responde **NO** (sí borraría todos los usuarios). Para que no pregunte, haz esto en orden:

```sql
-- 1) ¿hay correos repetidos? (por ejemplo, entraste con Google y con correo usando la misma dirección)
SELECT email, COUNT(*) AS cuentas, GROUP_CONCAT(id ORDER BY id) AS ids
FROM users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1;

-- 2) si los hay, decide cuál cuenta conservar. Esto conserva la más antigua y renombra las demás (no borra nada):
UPDATE users u
JOIN (SELECT email, MIN(id) AS keep_id FROM users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1) d
  ON u.email = d.email AND u.id <> d.keep_id
SET u.email = CONCAT('duplicado-', u.id, '+', u.email);

-- 3) crea el índice único a mano
ALTER TABLE users ADD UNIQUE INDEX users_email_unique (email);
```

Después ejecuta `npm run db:push`: solo agrega la columna `sessionVersion` y no hace preguntas.
En una base vacía (instalación nueva) no hace falta nada de esto.

## Cuentas con correo: cómo funciona

- Registrarse responde **lo mismo** exista o no el correo (no se puede averiguar quién tiene cuenta). Si ya tenía cuenta, le llega un aviso por correo.
- «Reenviar correo de verificación» genera un enlace nuevo y anula el anterior. Recuperar la contraseña también verifica el correo.
- Cambiar la contraseña, o «Cerrar sesión en todos los dispositivos» (Perfil), invalida todas las sesiones abiertas.
- Límites de intentos de inicio de sesión: por IP y por correo. En producción define `TRUSTED_PROXY_HOPS` (cuántos proxies hay delante) para que la IP no se pueda falsificar. Con Vercel reenviando `/api` a Railway suele ser **2**; compruébalo con `DEBUG_CLIENT_IP=true` (ver `.env.example`): si el valor es incorrecto, todos los usuarios comparten el mismo límite de intentos.

## Fotos (Cloudflare R2 / S3)

- Las fotos suben directo a R2 con una URL firmada de 5 minutos que ata **el tipo (JPG/PNG/WebP) y el tamaño exacto** del archivo (máximo 2 MB). Cada usuario puede pedir hasta 30 subidas por hora.
- Solo se pueden guardar imágenes que subió el propio dueño a su carpeta (`businesses/<id>/product`, `businesses/<id>/rescue-pack`, `couriers/<id>/profile`). Las URLs de terceros ya no se aceptan; las imágenes antiguas guardadas antes siguen funcionando mientras no se cambien.
- Al reemplazar o quitar una foto se borra la anterior del bucket (solo si es propia y nadie más la usa). Las fotos que se suben pero nunca se guardan quedan en el bucket: puedes poner una regla de ciclo de vida en R2 si te preocupa el espacio.
- El bucket necesita CORS con `PUT` desde tu dominio y `AllowedHeaders: ["content-type"]`.
- Si alguna vez R2 rechazara las subidas con `SignatureDoesNotMatch`, quita `"content-length"` de `signableHeaders` en `server/lib/image-rules.ts` (el tipo seguirá atado; el tamaño ya se valida al pedir la URL).

## Claves foráneas: actualizar una base que ya tiene datos

La base ahora impide datos inconsistentes (un pedido de un cliente que no existe, un ítem sin pedido…). Reglas de borrado:

- **Se borra en cascada** lo que no tiene sentido sin su dueño: al borrar un pedido, sus ítems, eventos, mensajes, ubicación, reclamos y valoraciones; al borrar un comercio sin pedidos, sus productos y packs; al borrar un usuario sin historial, sus tokens, direcciones y notificaciones.
- **Se protege el historial**: no se puede borrar un usuario o un comercio que tiene pedidos, mensajes, reclamos o valoraciones.
- **Se conserva el registro** aunque desaparezca quien lo originó: el pedido queda sin repartidor, el evento sin autor, el ítem sin enlace al producto (con su nombre y precio).

Si tu base ya tiene datos, **antes de `npm run db:push`**:

```bash
mysqldump -u USUARIO -p NOMBRE_DE_LA_BASE > copia.sql   # 1) copia de seguridad
npm run db:check                                          # 2) busca datos huérfanos (solo lee)
```

`db:check` te dice qué filas apuntan a algo que ya no existe y propone una consulta para verlas y otra para arreglarlas según la regla de cada relación. Aplica los arreglos (los de historial se deciden a mano), repite `npm run db:check` hasta que salga en verde y entonces ejecuta `npm run db:push`.

Si ejecutas `db:push` con datos huérfanos falla con el error 1452 y **deja la migración a medias** (no toca tus datos, pero aplica solo parte de las claves). No pasa nada: arregla los datos y vuelve a ejecutarlo, retoma lo que faltó. En una base nueva no hace falta nada de esto.

Al agregar una tabla o columna que apunte a otra, declara su clave foránea con `.references(...)`: el test `server/schema-integrity.test.ts` falla si queda alguna sin proteger.
