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
- Límites de intentos de inicio de sesión: por IP y por correo. En producción define `TRUSTED_PROXY_HOPS` (cuántos proxies hay delante) para que la IP no se pueda falsificar.
