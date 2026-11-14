# Despliegue en un VPS

Esto no despliega nada por sí solo. Prepara Postgres, la app y Chromium, y deja `data/profiles` en un volumen.

## 1. Máquina

Hace falta Docker y un VPS con escritorio virtual solo si quieres ver la ventana de login. En un servidor sin pantalla, Conectar no puede abrir Chromium visible: el login de OnlyFans sigue pidiendo una persona delante. El resto de lecturas usa el perfil que ya guardaste. Ese directorio (`data/profiles/<cuenta>`) lo abre un solo Chromium por cuenta: Conectar cierra la sala y espera como mucho 25 s a que terminen las lecturas en curso. Si siguen, no abre la ventana. No cierra el navegador debajo de una lectura. Fans en línea no navega la página de la escucha. No arranques otro proceso sobre la misma carpeta. Al soltar el perfil, Fanlink reescribe la sesión cifrada para no guardar una `sess` vieja.

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

Solo esa cuenta (el id `9ikis52` o el handle `@bigpoppa1111`, el que tenga guardado la ficha o la comprobación) puede salir de verdad. El servidor rechaza cualquier otra aunque la petición llegue igual. Hace falta el perfil de Chromium de Conectar. El envío abre `/my/chats/chat/{id}`, escribe en la caja y pulsa Send; el precio pasa por el modal nativo. No llama `api2` firmado. En el CRM la burbuja sale al instante, antes de esa espera. Si OnlyFans no devuelve el mensaje propio, el borrador queda en error: se puede reintentar a mano con el mismo id. Un envío ya marcado como enviado no se reintenta aunque hayan pasado 30 segundos. «Pendiente de confirmar» se muestra y no se reintenta; la dueña puede marcarlo como revisado, sin volver a mandarlo. Si el navegador ya se abrió y algo falla antes de confirmar, queda «Pendiente de confirmar» para no mandarlo dos veces. La clave anti-duplicado incluye al autor. Con los flags apagados el botón no se pulsa, Enter no encola y no se abre el navegador. No hace falta ninguna variable nueva y no cambia `FANLINK_SESSION_KEY`. Mientras el navegador tenga envíos en cola que aún no están confirmados en el servidor, cerrar la pestaña avisa: no se crea la fila al encolar. Cambiar de sección no tira esa cola. Un usuario vacío mientras la sesión carga tampoco. `reset()` solo corre si el cierre de sesión ha salido bien. Un envío que sigue vivo renueva su lease (`claimed_at` y el id del proceso, migración `0043_outbound_lease.sql`) y no se da por fallido aunque tarde más de 3 minutos. Si el proceso deja de latir, pasa a «Pendiente de confirmar» y no se reintenta. `0043` solo añade esas dos columnas, se puede volver a aplicar y no borra filas. El error de otro chatter no frena el hilo. La bóveda, en cada clic, pide como mucho 100 carpetas y 40 medios (`/api2/v2/vault/lists` y `/api2/v2/vault/media`). Es lectura, no el camino de Send, que no llama a `api2`. Si falla, se muestra el error y no se pulsa el compositor. Un medio comprado no se candado.

## 5b. Marcar leído al abrir un hilo

Apagado si no se define. No usa `FANLINK_ENABLE_SEND` y no cambia `FANLINK_SESSION_KEY`.

```bash
export FANLINK_CHAT_MARK_READ=true
export FANLINK_SEND_ALLOW_ACCOUNTS=9ikis52,@bigpoppa1111
```

Cualquier conversación que queda a la vista en el CRM (clic, flechas, la primera al abrir Mensajes, un aviso o el panel en línea) manda `POST /api2/v2/chats/{id}/mark-as-read` tras unos 800 ms seguidos con la pestaña visible, firmado con la regla actual, sin cuerpo y sin la ruta masiva. La primera conversación se elige una sola vez: un mensaje nuevo arriba no la cambia, y si la pastilla ya no la incluye sigue en la lista. La cuenta tiene que estar en `FANLINK_SEND_ALLOW_ACCOUNTS`. Con el flag apagado, o con otra cuenta, no sale ningún POST. La lista, el respaldo de Chromium y la vista en directo siguen sin poder marcar leído. Un 2xx pone `unread` a 0 y la negrita desaparece para todos los chatters. Un fallo deja el número como estaba. Un 401 o un 429 pausan la cuenta (respetando `Retry-After`) y un 401 deja la sesión rechazada. Si el chat se lee en OnlyFans, la siguiente lista firmada que traiga ese hilo lo deja con el número que traiga, también si es mayor que 0. Una lista que empezó antes de ese POST no repone el número viejo. Un hilo que la lista no trae conserva el suyo. El log es `creator=` y `ruta=mark-as-read status=` y no lleva ids de hilo ni tokens. Abrir otra vez un hilo que ya está en 0 no repite el POST.

## 6. Bandeja

Mensajes es la bandeja del CRM. No se monta la página de OnlyFans dentro del chat. Con el directo apagado, o en este proceso de despliegue (el socket solo existe con `npm run dev`), esa bandeja sigue siendo la pantalla. No se borra hasta que el directo funcione aquí.

Teclear, pulsar Enter y subir un archivo exigen además `FANLINK_ENABLE_SEND=true`. Si está apagado, la pestaña es solo lectura. La página no sale de `/my/chats` ni de la API de mensajes: `/my/statements`, `/my/statistics`, banca, pagos y ajustes quedan bloqueados, también si la página intenta cambiar la ruta por dentro. No se abren popups ni descargas. Al cerrar la sala se quitan esas guardias, para que la misma pestaña no las acumule si se vuelve a abrir. Una sala vacía se cierra a los 60 segundos (`FANLINK_LIVE_GRACE_MS`) y suelta el perfil. Una sala que no llegó a abrir no se queda en memoria. La sincronización y el envío del resto de la cuenta siguen usando el mismo perfil, el único Chromium de esa cuenta. Con `VITE_AUTH_ENABLED=false` en localhost funciona sin login. Con el acceso encendido hace falta una sesión con permiso de mensajes. El log es `[fanlink:live]` y no guarda lo que se escribe.

## 7. Tiempo real del chat

`GET /api/chat-live` es un stream SSE. El proxy no puede acumular la respuesta: nginx necesita `proxy_buffering off;` y la app ya manda `X-Accel-Buffering: no`. El timeout de lectura tiene que aguantar la conexión abierta (minutos, no el timeout corto de una API). Sin eso el navegador se entera del mensaje tarde o la conexión se corta.

Con la bandeja abierta, los hilos abiertos piden la primera página de mensajes cada 2 s. De un hilo que nadie tiene abierto no se pide `/messages`: de la lista se guarda solo el último mensaje. `FANLINK_CHAT_MESSAGE_PAGES` (1, 2 o 3; por defecto 1) limita las páginas de `/messages` si el llamador no pasa las suyas; la bandeja pide una. La primera página de `/api2/v2/chats` va cada 15 s y la lista completa cada 2 min, hasta `FANLINK_CHAT_LIST_CAP` (por defecto 60). La bandeja, el bucle de lista y la sincronización manual son un solo lector por cuenta, con al menos 300 ms entre peticiones. Un 401 pasa la cuenta a Expirada, o a Pendiente de login si la ventana de acceso ya está abierta, y no abre Chromium. Un 400 deja en la fila «OnlyFans rechazó la firma» y espera el backoff; la primera lectura correcta borra ese texto. Un 429 también. Si GitHub no entrega las reglas, se usa la última válida y no se reintenta antes de 5 min. Las `Set-Cookie` de esta lectura se parsean y no se escriben aquí. Al soltar el perfil se reescribe el JSON cifrado con las cookies del navegador. No hace falta otra clave y no se define `FANLINK_SESSION_KEY` aquí. Los tests de esta lectura usan `fetch` simulado y no llaman a onlyfans.com.

`npm run db:migrate` aplica también `0019_chat_author.sql` (autor del mensaje y borradores salientes), `0020_chat_card.sql` (ficha del fan), `0025_outbound_send.sql` (enviado o error del borrador), `0026_chat_history.sql` (cursor del histórico, me gusta, cita y aviso), `0027_mass_messages.sql` (borrador de masivos), `0033_outbound_match_unique.sql` (un borrador por mensaje y el índice único), `0034_notifications.sql` (avisos de cada cuenta y la marca de leído por persona), `0035_notification_first_seen.sql` (la columna `first_seen_at` si la tabla ya existía sin ella) y `0036_notification_key_text.sql` (quita el hash del texto de las claves antiguas sin id, conserva el `first_seen_at` más antiguo y copia las marcas de leído; no toca una clave nueva larga) y `0047_notification_counts.sql` (contadores de no leídas y `of_unread`). Sin ese comando la 0033 no entra y un despliegue con duplicados antiguos no arranca. `0034`, `0035` y `0036` se pueden volver a aplicar. Si `first_seen_at` se rellena en una fila vieja, usa `coalesce(first_seen_at, occurred_at, synced_at, now())`: la fecha del aviso va antes que `synced_at`, que es la última vez que se vio y no la primera. Hace falta Node `>=22.3`.

El espejo del hilo incluye el reproductor. Foto, vídeo y audio salen de `GET /api/chat-media`. La miniatura de la bóveda sale de `GET /api/vault-media`. Las dos exigen sesión: sin cookie responden 401, y un rol sin permiso 403. El cuerpo es el archivo, no una redirección al CDN. El log es `[fanlink:media]` con la cuenta y el id; no se escribe la URL firmada.

`npm run db:migrate` aplica también `0037_vault_mirror.sql` (piezas, listas y el puente si ya existía la bóveda antigua), `0038_vault_fan_filter.sql` (envíos a un fan y los filtros guardados de cada chatter) y `0039_outbound_media.sql` (medios de un borrador). Se pueden volver a aplicar. No borran filas. La búsqueda y los filtros de la bóveda (`POST /api/vault-query`) corren en el servidor. Un chatter no puede pedir el filtro de otro. `POST /api/vault-send` rechaza `NO VENDER` en el chat y en el masivo antes de abrir el navegador. El envío real de medios sigue sin existir: si el borrador lleva una pieza, no se abre OnlyFans. La lectura del panel firma `vault/lists` y `vault/media` y no abre la página de la bóveda ni un segundo Chromium. Las miniaturas de la página visible (40) las sirve `GET /api/vault-media` desde una caché en memoria (160 entradas, 10 minutos) para que no se pierdan al cambiar de página. Una URL caducada, o un 403/410 del CDN, vuelve a pedir `vault/media` una sola vez, con la lista y el offset de esa página, y usa la URL nueva. Si sigue rechazado, también en un GET suelto, los bytes salen una vez del lease del perfil (`borrowProfile`) y se suelta. Ese «un solo Chromium» lo pone el dueño del perfil: sin él, login y `borrowProfile` podían abrir dos sobre la misma carpeta. La caché son 160 entradas o 24 MB. La migración `0044_vault_thumb_page.sql` guarda esa página; se puede volver a aplicar y no borra filas. Sin miniatura el cuadro dice «Sin miniatura». El log `[fanlink:vault] miniatura status=` lleva el status y no la URL. No pulsa el compositor.

`0022_message_media.sql` y `0026_chat_history.sql` guardan los metadatos del mensaje. La reproducción pasa por el proxy autenticado, no por una URL suelta.

## 8. Masivos

`FANLINK_ENABLE_MASS_SEND` no se define, o no vale `true`. Igual que `FANLINK_ENABLE_SEND`. Las dos tienen que ser `true` y la cuenta tiene que estar en `FANLINK_SEND_ALLOW_ACCOUNTS` para que la compuerta del masivo se abra. En este despliegue no se abren: no hay transporte a OnlyFans. La migración del borrador es `0027_mass_messages.sql`. Aunque las dos estén en `true`, una pieza marcada `NO VENDER` o `SIN EDITAR` (o colgada de una carpeta que lo esté, o de una cadena rota) no se envía.

Aunque esa compuerta se abriera, el paso a enviado no es un flag. Un admin pide un token. La base guarda solo su hash, el id de ese admin y una caducidad de 2 minutos (`now()` del servidor más el intervalo). El mismo admin lo presenta en una segunda petición. La sentencia que marca `sent` exige el hash, que no haya caducado y que sea ese admin, y anula el token a la vez. Otro admin, un chatter o un token viejo no lo consumen. Si el token sigue vivo, no se pide otro encima.

## 9. Notificaciones

El proceso lee las notificaciones de cada cuenta activa con sesión guardada por api2 firmada, sin abrir Chromium. La primera página sale cada 45 segundos, con un lector por cuenta y 300 ms entre peticiones. `FANLINK_SYNC_ENABLED=false` apaga también ese bucle. No hace falta otra variable. Un 401 en la lista deja la cuenta en Expirada. `GET /users/me` solo se usa para `newTagsCount`. `npm run db:migrate` aplica `0047_notification_counts.sql`, `0046_notification_fan_card.sql` (avatar, @usuario, listas, renovación y lastSeen; no se reescribe) y `0048_notification_post.sql` (texto y enlace de la publicación, `add column if not exists`). Marcar leída en OnlyFans exige `FANLINK_NOTIF_MARK_READ=true` y la cuenta en `FANLINK_SEND_ALLOW_ACCOUNTS`; si no, no hay POST. Esa marca, cuando sale, vale para todos los que miran la cuenta. Lo que tiene fecha y supera 90 días se borra en la siguiente pasada. Un aviso sin fecha cuenta esos 90 días desde `first_seen_at`. En una fila nueva es el momento del primer guardado y no se mueve si el aviso vuelve. En una fila que ya estaba, `0035_notification_first_seen.sql` la rellena con `coalesce(first_seen_at, occurred_at, synced_at, now())`. La ficha del chat pide solo los hilos visibles, no todos los fans. `listChatFanCards`: un chatter ve gasto, compras, propinas, suscripción, renovación y estado de cualquier cuenta de la bandeja. No recibe ingresos totales, beneficios, pagos ni el dashboard agregado. Si falta un dato, la ficha dice Sin datos.
