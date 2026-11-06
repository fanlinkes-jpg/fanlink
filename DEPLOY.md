# Despliegue en un VPS

Esto no despliega nada por sí solo. Prepara Postgres, la app y Chromium, y deja `data/profiles` en un volumen.

## 1. Máquina

Hace falta Docker y un VPS con escritorio virtual solo si quieres ver la ventana de login. En un servidor sin pantalla, Conectar no puede abrir Chromium visible: el login de OnlyFans sigue pidiendo una persona delante. El resto de lecturas usa el perfil que ya guardaste.

No generes otra `FANLINK_SESSION_KEY` si ya tienes `data/sessions`. Esa clave descifra las sesiones y los proxies.

## 2. Arranque

En el servidor, con la clave que ya usas:

```bash
export FANLINK_SESSION_KEY="la clave que ya tienes"
export POSTGRES_PASSWORD="una clave solo de esta base"
docker compose up --build
```

- Postgres queda en el volumen `pgdata` y no publica el puerto 5432 al host.
- La contraseña sale de `POSTGRES_PASSWORD`. No hay una clave fija en el compose.
- `VITE_AUTH_ENABLED` queda en `true`. Con `DATABASE_URL`, apagar el acceso dejaría la app cerrada a propósito.
- Al arrancar el proceso con Postgres, el planificador de sincronización también arranca. No hace falta abrir antes una página.
- `data/profiles` y `data/sessions` viven en el volumen `fanlink-data`, montado en `/app/data`.

La imagen usa `NITRO_PRESET=node-server` y arranca con `node .output/server/index.mjs`. Playwright va en la imagen base.

Para comprobar Postgres sin Docker, con la base ya creada:

```bash
export DATABASE_URL="postgres://fanlink:${POSTGRES_PASSWORD}@127.0.0.1:5432/fanlink"
npm run db:migrate
```

Tiene que listar las migraciones aplicadas, incluida `0019_chat_author.sql` y `0033_outbound_match_unique.sql`. `npm run db:migrate` es el paso que las aplica: la 0033 desempareja los borradores repetidos de un mismo mensaje y después crea el índice único. Los tests de la suite usan PGLite, que ejecuta los mismos SQL. Un test contra Postgres de verdad solo corre si `DATABASE_URL` apunta a una base vacía de pruebas: `node --experimental-strip-types --test server/of-sessions/test/postgres.test.ts`.

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

`FANLINK_ALERT_QUIET_MIN` es el mínimo entre avisos del mismo fan. `FANLINK_ALERT_MODE` vale `all` (defecto: todos los chatters con avisos), `assigned` (solo quien tiene la cuenta) o `users` (la lista `FANLINK_ALERT_USERS`, ids separados por comas). El teléfono de cada miembro se guarda en Equipo.

## 5. Envío real de un chat

Sigue apagado si no pones las dos variables. No cambia `FANLINK_SESSION_KEY`. Los masivos de Campañas no usan esta puerta: siguen sin salir a OnlyFans.

```bash
export FANLINK_ENABLE_SEND=true
export FANLINK_SEND_ALLOW_ACCOUNTS=9ikis52,@bigpoppa1111
export FANLINK_SEND_PER_MINUTE=4
```

Solo esa cuenta (el id `9ikis52` o el handle `@bigpoppa1111`, el que tenga guardado la ficha o la comprobación) puede pulsar Enviar. El servidor rechaza cualquier otra aunque la petición llegue igual. Hace falta el perfil de Chromium de Conectar. El envío abre `/my/chats/chat/{id}`, escribe en la caja y pulsa Send; el precio pasa por el modal nativo. No llama `api2` firmado. Si OnlyFans no devuelve el mensaje propio, el borrador queda en error y no se reintenta.

## 6. Tiempo real del chat

`GET /api/chat-live` es un stream SSE. El proxy no puede acumular la respuesta: nginx necesita `proxy_buffering off;` y la app ya manda `X-Accel-Buffering: no`. El timeout de lectura tiene que aguantar la conexión abierta (minutos, no el timeout corto de una API). Sin eso el navegador se entera del mensaje tarde o la conexión se corta.

`npm run db:migrate` aplica también `0019_chat_author.sql` (autor del mensaje y borradores salientes), `0020_chat_card.sql` (ficha del fan), `0025_outbound_send.sql` (enviado o error del borrador), `0026_chat_history.sql` (cursor del histórico, me gusta, cita y aviso) y `0033_outbound_match_unique.sql` (un borrador por mensaje y el índice único). Sin ese comando la 0033 no entra y un despliegue con duplicados antiguos no arranca.

El espejo del hilo no incluye el reproductor ni la caché de medios. `0022_message_media.sql` y `0026_chat_history.sql` solo guardan metadatos (si hay archivo, duración, vista previa, me gusta, cita). No se descarga el archivo y en el hilo se pinta el marcador Medio.

## 6. Masivos

`FANLINK_ENABLE_MASS_SEND` no se define, o no vale `true`. Igual que `FANLINK_ENABLE_SEND`. Las dos tienen que ser `true` y la cuenta tiene que estar en `FANLINK_SEND_ALLOW_ACCOUNTS` para que la compuerta del masivo se abra. En este despliegue no se abren: no hay transporte a OnlyFans. La migración del borrador es `0027_mass_messages.sql`.

Aunque esa compuerta se abriera, el paso a enviado no es un flag. Un admin pide un token. La base guarda solo su hash, el id de ese admin y una caducidad de 2 minutos (`now()` del servidor más el intervalo). El mismo admin lo presenta en una segunda petición. La sentencia que marca `sent` exige el hash, que no haya caducado y que sea ese admin, y anula el token a la vez. Otro admin, un chatter o un token viejo no lo consumen. Si el token sigue vivo, no se pide otro encima.
