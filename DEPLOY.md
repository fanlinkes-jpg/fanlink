# Despliegue en un VPS

Esto no despliega nada por sí solo. Prepara Postgres, la app y Chromium, y deja `data/profiles` en un volumen.

## 1. Máquina

Hace falta Docker y un VPS con escritorio virtual solo si quieres ver la ventana de login. En un servidor sin pantalla, Conectar no puede abrir Chromium visible: el login de OnlyFans sigue pidiendo una persona delante. El resto de lecturas usa el perfil que ya guardaste.

No generes otra `FANLINK_SESSION_KEY` si ya tienes `data/sessions`. Esa clave descifra las sesiones y los proxies.

## 2. Arranque

En el servidor, con la clave que ya usas:

```bash
export FANLINK_SESSION_KEY="la clave que ya tienes"
docker compose up --build
```

- Postgres queda en el volumen `pgdata`.
- La app usa `DATABASE_URL=postgres://fanlink:fanlink@postgres:5432/fanlink`.
- Al arrancar, `npm run build` ejecuta las migraciones de `migrations/` contra esa URL.
- `data/profiles` y `data/sessions` viven en el volumen `fanlink-data`, montado en `/app/data`.

La imagen usa `NITRO_PRESET=node-server` y arranca con `node .output/server/index.mjs`. Playwright va en la imagen base.

Para comprobar Postgres sin Docker, con la base ya creada:

```bash
export DATABASE_URL="postgres://fanlink:fanlink@127.0.0.1:5432/fanlink"
npm run db:migrate
```

Tiene que listar las migraciones aplicadas, incluida `0012` en adelante. Los tests de la suite usan PGLite, que ejecuta los mismos SQL. Un test contra Postgres de verdad solo corre si `DATABASE_URL` apunta a una base vacía de pruebas: `node --experimental-strip-types --test server/of-sessions/test/postgres.test.ts`.

## 3. Proxy por cuenta

En Creadoras, la dueña abre Más y guarda un proxy `http://`, `https://` o `socks5://`. El usuario y la contraseña se cifran con `FANLINK_SESSION_KEY` en `data/proxies/<cuenta>.bin`. Chromium de esa cuenta lo usa al conectar, comprobar y sincronizar. La contraseña no vuelve a la pantalla ni al log.

## 4. WhatsApp

Sin estas variables, el aviso se queda en el log como `simulado` y el teléfono sale enmascarado. No pongas claves de ejemplo reales.

Twilio:

```bash
export FANLINK_WHATSAPP_PROVIDER=twilio
export FANLINK_TWILIO_ACCOUNT_SID=
export FANLINK_TWILIO_AUTH_TOKEN=
export FANLINK_TWILIO_WHATSAPP_FROM=
```

Cloud API de WhatsApp:

```bash
export FANLINK_WHATSAPP_PROVIDER=cloud
export FANLINK_WHATSAPP_TOKEN=
export FANLINK_WHATSAPP_PHONE_ID=
```

`FANLINK_ALERT_QUIET_MIN` es el mínimo entre avisos del mismo fan. El teléfono de cada miembro se guarda en Equipo.
