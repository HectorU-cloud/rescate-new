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
