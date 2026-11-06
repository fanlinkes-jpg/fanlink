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

Tiene que listar las migraciones aplicadas, incluida `0019_chat_author.sql`. Los tests de la suite usan PGLite, que ejecuta los mismos SQL. Un test contra Postgres de verdad solo corre si `DATABASE_URL` apunta a una base vacía de pruebas: `node --experimental-strip-types --test server/of-sessions/test/postgres.test.ts`.

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

## 5. Tiempo real del chat

`GET /api/chat-live` es un stream SSE. El proxy no puede acumular la respuesta: nginx necesita `proxy_buffering off;` y la app ya manda `X-Accel-Buffering: no`. El timeout de lectura tiene que aguantar la conexión abierta (minutos, no el timeout corto de una API). Sin eso el navegador se entera del mensaje tarde o la conexión se corta.

`npm run db:migrate` aplica `0019_chat_author.sql`, `0020_chat_card.sql`, `0028_message_media.sql`, `0029_vault_media.sql`, `0030_outbound_media.sql` y `0031_outbound_media_owner.sql`. La 0021 a la 0027 quedan para el hilo y los masivos. `0028` usa `add column if not exists`: si el #4 ya creó `media_count`, `media_seconds`, `media_preview` y `media_json`, no falla. Si la 0030 ya se aplicó sin `creator_id`, la 0031 copia `creator_id` desde `of_chat_outbound` y solo borra la fila cuyo borrador ya no existe.

La miniatura de la bóveda se cachea en `data/media-cache` y responde con el content-type real y `X-Content-Type-Options: nosniff`. Las lecturas de medio de una misma cuenta van de una en una, para no retrasar la sincronización. El vídeo con URL firmada se reenvía en streaming; la sesión solo entra si esa lectura caduca. Una playlist HLS master se reescribe a la variante y la variante a los segmentos.

`FANLINK_PRICE_RULE` sustituye la regla de precio de la bóveda. Sin esa variable se usa la regla por defecto, que en pantalla se llama **Regla** y no es un precio leído de OnlyFans. Las ventas y el precio por pieza solo salen para la dueña. El adjunto de la bóveda se guarda en `of_outbound_media` por id y `creator_id`, con clave foránea a `of_chat_outbound`: borrar el borrador borra sus medios. Si el texto lleva el título o el acto del medio, el borrador se rechaza y el aviso nombra la palabra. Una línea que empieza por `[adjunto]` también se rechaza. La pareja no se usa para eso. `NO VENDER` y `SIN EDITAR` se niegan en el servidor, igual que un id que no es de esa creadora, una cadena de carpetas incompleta o un ciclo de carpetas. El borrador y `of_outbound_media` se escriben en la misma transacción. El precio PPV del borrador se valida otra vez en el servidor (gratis, o de 3 a 200 USD). Mientras no exista el envío real de medios, `deliverIfNoMedia` bloquea cualquier borrador que tenga filas en `of_outbound_media`. El conteo de medios de un envío es obligatorio. La playlist y el trozo de `/api/chat-media` responden `X-Content-Type-Options: nosniff`.

## 6. Masivos

`FANLINK_ENABLE_MASS_SEND` no se define, o no vale `true`. Igual que `FANLINK_ENABLE_SEND`. Las dos tienen que ser `true` y la cuenta tiene que estar en `FANLINK_SEND_ALLOW_ACCOUNTS` para que la compuerta del masivo se abra. En este despliegue no se abren: no hay transporte a OnlyFans. La migración del borrador es `0027_mass_messages.sql`.

Aunque esa compuerta se abriera, el paso a enviado no es un flag. Un admin pide un token. La base guarda solo su hash, el id de ese admin y una caducidad de 2 minutos (`now()` del servidor más el intervalo). El mismo admin lo presenta en una segunda petición. La sentencia que marca `sent` exige el hash, que no haya caducado y que sea ese admin, y anula el token a la vez. Otro admin, un chatter o un token viejo no lo consumen. Si el token sigue vivo, no se pide otro encima.
