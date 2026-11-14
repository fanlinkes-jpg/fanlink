# Fanlink

CRM de la agencia y sesiones de OnlyFans. El equipo entra en Fanlink con su propia cuenta. La cuenta de OnlyFans la abre la dueña en una ventana de Chromium: Fanlink no pide ni guarda esa contraseña.

## Sesión del equipo y sesión de OnlyFans

Son dos cosas distintas.

- **Equipo.** better-auth, en `/login`. Es quien puede ver el CRM y pulsar Conectar.
- **OnlyFans.** Playwright abre Chromium con un perfil por creadora. Cuando la página llega al feed, se guardan cookies y localStorage cifrados. No hay formulario de contraseña en Fanlink.

## Cómo ejecutarlo

Hace falta Node `>=22.3`. `.nvmrc` fija `22.3.0`. La huella de una clave larga usa `process.getBuiltinModule`.

```bash
npm install
npx playwright install chromium
export FANLINK_SESSION_KEY="$(openssl rand -base64 32)"
npm run dev
```

Abre `http://127.0.0.1:8080`. En **Administrar creadoras** el estado de cada cuenta sale del módulo de sesiones: **Activa**, **Pendiente de login** o **Expirada**. **Conectar** o **Reconectar** abre la ventana en el equipo donde corre este proceso (hace falta `DISPLAY` o `WAYLAND_DISPLAY` en Linux).

Sin `FANLINK_SESSION_KEY` no se escribe la sesión. No hay un modo en claro.

## Estados

| Indicador          | Significado                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| Activa             | Hay storage state cifrado y las cookies `auth_id` y `sess` siguen vigentes. |
| Pendiente de login | No hay sesión, o la ventana de acceso está abierta.                         |
| Expirada           | La sesión guardada ya no sirve y la ventana no está abierta.                |

Si OnlyFans rechaza la sesión, el indicador pasa a expirada. Para volver a entrar hay que pulsar Reconectar. Con `FANLINK_OPEN_LOGIN_ON_INVALIDATE=true` el servidor reabre la ventana solo.

## Base compartida

La consola guarda creadoras, fans y el resto en una sola fila del servidor, con versión. Si dos personas guardan a la vez, gana la primera y la otra vuelve a cargar esa copia. El navegador ya no conserva una segunda copia en `localStorage` que pueda pisar al servidor. Si había datos solo en este navegador y el servidor está vacío, se importan una vez y se borra esa copia local.

Sin `DATABASE_URL`, esa base es un Postgres embebido en `data/pglite` (un solo proceso de Fanlink). Al reiniciar el proceso los datos siguen ahí. Dos procesos a la vez sobre esa carpeta no son seguros. Para un equipo o un futuro motor en un VPS, define `DATABASE_URL` apuntando a Postgres. El navegador solo habla con ese servidor; el login de Chromium y `data/sessions` viven en la máquina del proceso, no en cada ordenador. Eso todavía no es un despliegue: es la forma en que corre `npm run dev`.

`VITE_AUTH_ENABLED=false` solo funciona en localhost y sin `DATABASE_URL`. Es un operador local, no separa a varias personas. En cuanto hay base real, hace falta el login del equipo.

La pastilla **Activa** es la sesión guardada (cookies). **Conexión** es una comprobación aparte. **Identidad** compara el `username` leído con el handle de la ficha, sin distinguir `@` ni mayúsculas.

Al pulsar **Comprobar**, el servidor abre la home con la sesión guardada. El listener se registra antes de navegar. Espera a que la red se calme y, si aún no hay usuario, hasta 15 segundos más. Acepta el JSON que la propia página pide si la ruta contiene `/users/me` (vale `/api2/v2/users/me` y una query) o termina en `/api/me`. De ese JSON copia `username`, `name` o `displayName`, e `id` numérico. No llama a ese endpoint ni firma peticiones.

Si en la home no aparece, lee el estado que la página ya tiene (`window.__INITIAL_STATE__`, `__NUXT__`, `__PINIA__`, Vuex o Pinia), solo lectura. Luego, si el sitio declara selector, el texto y `data-username`. Como último recurso, un enlace del menú con href `/<username>` o un único `@username` visible ahí. Si sigue sin usuario, abre `https://onlyfans.com/my/profile` y repite la lectura.

Si no se puede verificar, bajo **No verificada** sale la razón (por ejemplo `no hubo respuesta users/me`, `campo username ausente` o `redirigido a login`) y, en el servidor, las rutas JSON sin query. No se guardan ni se escriben cookies, tokens, cabeceras, query ni cuerpos. Si OnlyFans cambia la ruta, los campos o el menú, la conexión puede seguir en Aceptada y la identidad en **No verificada**.

- **Verificada**: el handle leído coincide con el de la ficha.
- **No coincide**: la sesión es de otra cuenta. Se muestra el handle leído y se bloquean lecturas futuras de datos para esa ficha.
- **No verificada**: no se pudo leer un username, o la ficha no tiene handle. No impide sincronizar.

## Lectura de ingresos y fans

La lectura automática abre primero el feed y, si `users/me` trae username, las páginas `https://onlyfans.com/my/statements/earnings` y `https://onlyfans.com/my/subscribers/active`. El listener se registra antes de navegar. Se guardan solo los campos que el JSON o el DOM dejan leer: día e importes por suscripciones, propinas, mensajes y posts; fans con id, handle, nombre, fecha, estado y gasto si viene. Hay pausas, como mucho tres desplazamientos y una cuenta cada vez. Esa lectura de ingresos y fans no envía nada y no llama a un endpoint: se queda con el JSON que pide la página. La lista de chats sí llama a `/api2/v2` firmado; el ritmo está más abajo. La fila de Creadoras no tiene botón de sincronizar. La dueña puede forzarla desde Más o desde Analítica. Un miembro recibe rechazo del servidor.

Fragilidad: si OnlyFans cambia esas páginas, los nombres de los campos o deja de pedir ese JSON, la sincronización no inventa cifras. La razón puede ser `sin respuesta de ingresos`, `sin respuesta de fans`, `página cambiada` o `redirigido a login`, con las rutas JSON sin query. Las conversaciones son comunes: `creatorIdsForChats` devuelve todas las cuentas, y cualquier chatter con permiso de mensajes ve y trabaja esos chats. El gasto del fan (`spentCents`) también lo ven todos los chatters: es intencional, porque hace falta para chatear. Los ingresos de la agencia y de las creadoras, y el bruto de los demás chatters, solo los ve la dueña. Cada chatter ve su propio bruto, atribuido al autor guardado en el CRM cuando el mensaje sincronizado casa con lo que escribió. La asignación de cuenta se guarda, pero no limita el chat. Si la identidad es **No coincide**, no se sincroniza.

Hasta que exista una sincronización, Analítica y Fans muestran **Sin sincronizar**. El origen guardado es `onlyfans`. Abrir la pantalla solo lee lo guardado: no lanza una sincronización.

El servidor sincroniza solo cada cuenta con sesión activa. Por defecto cada 30 minutos (`FANLINK_SYNC_INTERVAL_MIN`). La dueña puede cambiarlo en Analítica, entre 5 y 1440 minutos; ese valor guardado manda sobre la variable. Va de una en una, con un margen al azar de 15 a 90 segundos entre cuentas. No entra una cuenta con identidad **No coincide**, ni una sesión caducada o sin guardar. Si esa cuenta ya se está sincronizando (también a mano), no se lanza otra. Tras dos fallos seguidos la siguiente espera es el doble, luego el cuádruple, hasta 16 veces el intervalo. `FANLINK_SYNC_ENABLED=false` apaga el planificador. En la fila se ve «Última sincronización: hace X min» y el estado: en curso, OK o error con el motivo.

## Permisos

Decisión del dueño, del 2026-11-06: cualquier chatter ve el gasto de cada fan en todas las creadoras. El código lo mantiene así.

- Un miembro con permiso de mensajes ve y trabaja los chats de todas las cuentas. `creatorIdsForChats` devuelve todas, y `canOperateCreator` con `mensajes` no mira la asignación. La asignación se guarda, pero no recorta el chat.
- El gasto de cada fan (`spentCents`) sale en la bandeja, bajo el avatar, y en la ficha del fan para cualquier chatter, en todas las creadoras. `presentRead` no lo quita a un miembro. El color sale de `SPEND_TIERS` en `src/lib/spend-tiers.ts`: $0 gris, hasta $50 verde, hasta $200 azul, hasta $1000 morado, y por encima dorado. Si OnlyFans trae `subscribedOnData.totalSumm` y es 0, se guarda 0 y bajo el avatar sale $0.00. Si el campo no viene, sigue en Sin datos.
- Los ingresos agregados de una creadora los ve solo la dueña. `canSeeAgencyEarnings` es cierto solo para el rol owner. Un miembro recibe `earnings` y `transactions` en null, y en Inicio `dayGrossCents` y `monthGrossCents` también en null.
- El bruto de otro chatter lo ve solo la dueña. Cada chatter ve el suyo (`canSeeChatterFigures`).
- Forzar la sincronización solo lo puede la dueña.

## Chats, solo lectura

El mismo planificador abre `https://onlyfans.com/my/chats` y, por defecto, hasta 8 hilos, primero los no leídos (`FANLINK_CHAT_OPEN_UNREAD=false` lo deja en los más recientes). La ruta del hilo es `/my/chats/chat/{id}`. Escucha el JSON que esas páginas piden y no llama endpoints por su cuenta. Si un chatter deja un mensaje pendiente, se guarda su autor y, al sincronizar, se casa con el mensaje real por texto, hora, precio o id.

La migración `0033_outbound_match_unique.sql` deja un solo borrador por mensaje de OnlyFans (el de menor diferencia de hora, o el más antiguo si ese mensaje ya no está) y crea el índice único de `matched_message_key`. Hay que aplicarla con `npm run db:migrate` antes de arrancar contra una base que ya tenga chats.

El envío real de un chat solo sale si `FANLINK_ENABLE_SEND=true` y la creadora está en `FANLINK_SEND_ALLOW_ACCOUNTS` (ids o handles, con o sin `@`, separados por coma). Cualquier otra cuenta sigue apagada en el servidor, no solo en el botón. Abre el perfil persistente de Chromium, entra en `/my/chats/chat/{id}`, escribe en la caja nativa y pulsa Send. El precio usa el modal Price nativo. No firma ni llama `api2` por su cuenta: espera a ver el mensaje propio en el JSON o el WebSocket que la página recibe, y entonces marca `of_chat_outbound` como enviado con el autor y el id de OnlyFans. Si no aparece, queda en error con el motivo. No hay reintento automático. Un error se puede reintentar a mano, con el mismo id. Un mensaje ya enviado o «Pendiente de confirmar» no se reintenta, ni a mano ni solo, aunque hayan pasado los 30 s de la clave de `claimSend`. Va de uno en uno por cuenta, con un tope por minuto (`FANLINK_SEND_PER_MINUTE`, por defecto 4) y un retardo entre teclas. Los masivos de Campañas siguen sin salir a OnlyFans.

En el hilo, el mensaje del chatter aparece al pulsar Enter (Mayúsculas+Enter sigue siendo un salto de línea), con el texto «Enviando…», y el borrador, el precio y los adjuntos se vacían en ese momento. El `clientId` (un uuid) es el id de la fila de `of_chat_outbound`: al refrescar no sale duplicado. Si OnlyFans confirma, la burbuja se sustituye por el mensaje. Si queda a medias, dice «Pendiente de confirmar». Si falla, dice «No se envió: motivo», con Reintentar, Descartar y Recuperar. Recuperar devuelve al compositor el texto, el precio y las piezas. Los envíos de un mismo hilo van en orden; otro hilo no espera. Si uno falla, los siguientes de ese hilo no salen hasta Reintentar o Descartar. **No se crea la fila al encolar.** La fila nace cuando `sendChatMessage` llega al servidor. Mientras la cola del navegador no está vacía (en espera, enviando o en error), cerrar o recargar la pestaña avisa con `beforeunload`, para que un mensaje que aún no salió no se pierda en silencio. Esa cola vive fuera de la página: cambiar de sección con el menú no la tira. Enviado y pendiente de confirmar ya están en el servidor y no avisan. El autor de la fila sale siempre de la sesión. El historial al fan (`noteVaultFanSend`) solo se escribe cuando OnlyFans confirma, como antes. Con los flags apagados el botón Enviar no se puede pulsar: Enter no encola y muestra «Envío real desactivado», y no se abre el navegador. La clave anti-duplicado incluye al autor, así que dos chatters pueden mandar el mismo texto. Si el navegador ya se abrió y algo falla antes de confirmar, queda «Pendiente de confirmar» y no se reintenta. Un envío que sigue vivo renueva su lease (`claimed_at` y el id del proceso) y no se da por fallido aunque tarde más de 3 minutos. Si el proceso deja de latir, pasa a «Pendiente de confirmar» y no se reintenta. El error de otro chatter no frena tu hilo. Descartar solo quita la burbuja si el servidor acepta; un 403 no se da por hecho. Recuperar y Reintentar devuelven el precio y las piezas guardados.

El histórico no se corta en 8 hilos. Al subir del todo en el hilo, la pestaña de la cuenta hace scroll en el chat nativo y se guarda el JSON de mensajes que esa página pide. Ese barrido abre Chromium y tumba la sesión, así que solo arranca con `FANLINK_HISTORY_ENABLED=true`. En segundo plano se recorre el resto de chats, de uno en uno, con tope por minuto (`FANLINK_HISTORY_PER_MINUTE`, por defecto 6) y un cursor por chat (`history_cursor`, `history_done`) para poder seguir más tarde. La lista de chats también pide la página siguiente al llegar abajo.

Cada mensaje guarda los metadatos del medio que venga (tipo, duración y si hay vista previa), el me gusta, la cita y el aviso de compra o propina. En el hilo, foto, vídeo y audio se reproducen con el botón **Reproducir** (o **Ver foto** / **Reproducir audio**). El archivo sale de `GET /api/chat-media`, que exige sesión. No se pinta la URL del CDN.

Por defecto el barrido de hilos es cada 2 minutos (`FANLINK_CHAT_SYNC_MIN`, entre 1 y 30). Tener la bandeja abierta no lo acorta. Con la bandeja abierta, los hilos abiertos piden solo la primera página de mensajes cada 2 s. De un hilo que nadie tiene abierto no se pide `/messages`: de la lista se guarda solo el último mensaje. Un chat con `unreadMessagesCount` mayor que 0 sale en negrita y con ese número; un hilo silenciado no lleva el badge. La pestaña Mensajes, para la cuenta elegida, cuenta los chats de la última lista firmada con ese campo mayor que 0. Esa es la cifra de OnlyFans: cuántas conversaciones de `/api2/v2/chats` traen no leídos, no la suma de mensajes. Mientras carga, si falla o si ningún hilo trae el campo, dice «Sin datos» y no un 0. La lista firmada solo pisa el no leído de los hilos que trae, también cuando OnlyFans dice 0: así, si el chat se leyó en OnlyFans, la siguiente lista completa lo deja en 0 en el CRM y quita la negrita. Puede tardar lo que tarde ese barrido; no hay otra ruta ni otro sondeo. Un hilo que no vino, también uno por debajo de esos ~60, conserva su número. La primera página, de 20, solo actualiza esos 20. Una lista que empezó antes de marcar leído desde el CRM no repone el número viejo: el 0 se queda hasta que una lectura posterior trae el 0 de OnlyFans. Si el campo no viene, no se guarda un 0 y el log dice `creator=`. Abrir el hilo en la vista en directo o en el respaldo de Chromium no manda `POST /api2/v2/chats/{id}/mark-as-read`, ni `POST /api2/v2/chats/mark-as-read`, ni `POST .../messages/read`. El clic que abre el hilo en el CRM sí puede mandar `POST /api2/v2/chats/{id}/mark-as-read`, y solo ese: hace falta `FANLINK_CHAT_MARK_READ=true` y la cuenta en `FANLINK_SEND_ALLOW_ACCOUNTS`. Apagado, no sale ningún POST. Si OnlyFans responde 200, el no leído pasa a 0 para todo el equipo. Si falla, el número se queda y el log dice `ruta=mark-as-read status=` sin ids ni tokens. La ruta masiva no se usa. Deja de estar en negrita cuando la lista firmada trae 0. `FANLINK_CHAT_MESSAGE_PAGES` (1, 2 o 3; por defecto 1) es el tope de páginas de `/messages` cuando quien llama no fija el suyo; la bandeja pasa siempre 1. La primera página de `/api2/v2/chats` se pide cada 15 s y la lista completa, hasta `FANLINK_CHAT_LIST_CAP` (por defecto 60, como mucho `ceil(tope/20)` páginas), cada 2 min. La bandeja, el bucle de lista y la sincronización manual comparten un solo lector por cuenta y al menos 300 ms entre peticiones de esa cuenta. Esa lectura no abre Chromium. Un 401 deja la cuenta en **Expirada**, o en **Pendiente de login** si la ventana de acceso ya está abierta, con el motivo en el error de la fila, y no lanza el navegador. Un 400 deja en la fila «OnlyFans rechazó la firma» y espera el backoff, sin repetir cada 15 s. La primera lectura que sí trae hilos o mensajes borra ese texto. Un 429 también espera el backoff. El SSE `GET /api/chat-live` mira la base cada 2 s. La pantalla consulta cada 5 s. Si faltan `auth_id`, `sess` o `x-bc`, sigue el respaldo de una sola pestaña por cuenta: escucha el WebSocket y no envía ningún frame. Si ese respaldo no trae mensajes, se recargan los hilos vigilados, primero el que más gente mira, nunca antes de 15 segundos por hilo y nunca más de un hilo cada 15 segundos, con un tope de 8. La pestaña se cierra a los 5 minutos sin nadie mirando. El perfil solo admite una cuenta a la vez: si hay dos, se queda la que más bandejas tiene abiertas y la otra espera.

La firma de `api2` usa las reglas públicas de [DATAHOARDERS/dynamic-rules](https://github.com/DATAHOARDERS/dynamic-rules) (`onlyfans.json`). El tiempo va en milisegundos. En las rutas con query, que son las de la lista y los mensajes, se firma con el id real y se manda `user-id`. En una ruta sin query, esta rama quita `user-id` si está en `remove_headers` y firma con `0`. Ese corte no es el de `3064d53`: allí el id real entra en el hash y la cabecera `user-id` sale en todas las rutas. OF-Scraper `create_login_sign` también firma con el `auth_id` real, y `remove_headers` de DATAHOARDERS no mira si hay query. El checksum es la suma de los bytes del hash en `checksum_indexes` más `checksum_constant`. No se vuelven a sumar `checksum_constants`: `checksum_constant` ya es esa suma, y si no coinciden la regla se tira. Si la descarga falla o tarda más de 5 s, se sigue con la última regla válida y no se vuelve a pedir antes de 5 min. Las cabeceras las arma una sola función. Las `Set-Cookie` que rota OnlyFans se parsean y quedan en el resultado de la lectura. Esta lectura no escribe el JSON cifrado ni genera `FANLINK_SESSION_KEY`. Al soltar el perfil de Chromium se reescribe ese JSON con las cookies que el navegador tiene en ese momento, incluida `sess`.

Para dirimir el corte en el Mac, sin cambiarlo todavía: para el CRM antes (`npm run dev`). La sonda no usa el lector de la cuenta. Desde la raíz del repo, en esta rama, y en el terminal donde ya está exportada la clave (`source ~/.fanlink-session-key`): `npm run probe:sign -- --account 3zk7kbr`. `--account` es el id de creadora, el handle o el id de la cuenta. Usa la sesión local y `FANLINK_SESSION_KEY` del entorno; no imprime la clave, ni cookies, ni el cuerpo. Hace como mucho cuatro GET, sin query y sin escritura, a `/api2/v2/users/me` y a `/api2/v2/users/notifications/count`. Cada ruta se firma de las dos maneras: A, id real y cabecera `user-id`; B, id `0` y sin esa cabecera. Entre una petición y la siguiente pasan al menos 1 s. La salida es solo la ruta, la variante y el estado HTTP. Si sale un 429, se imprime esa línea y se para: no se relanza y no se interpreta.

| A | B | Lectura |
| --- | --- | --- |
| 200 | 400 | El id real va en todas las rutas |
| 400 | 200 | El corte de esta rama (sin query, id 0) |
| 200 | 200 | Una sola regla, la A, a falta de un POST real |
| 401 | 401 | Sesión |
| 429 o error | | Inconcluso |

Los hilos y los mensajes se guardan por creadora y por fan, y los ve todo el equipo. Un mensaje nuevo de un fan crea el evento interno `new_fan_message`. La segunda lectura del mismo mensaje no lo repite. Solo la dueña ve **Forzar sincronización**; el servidor se lo niega a un miembro. Un miembro con permiso de mensajes puede operar el chat de cualquier cuenta: la asignación no lo recorta.

Fragilidad: si OnlyFans cambia la ruta del chat, la caja, el botón Send o los campos `withUser`, `lastMessage`, `text` y `createdAt`, la lista puede quedar vacía o el envío queda en error con el motivo. Ese error no se reintenta solo.

## Notificaciones de cada cuenta

Un bucle aparte abre `https://onlyfans.com/my/notifications` cada 30 minutos, una cuenta cada vez, y escucha el JSON que esa página pide. No llama a un endpoint por su cuenta. Hace un solo desplazamiento, con 8 segundos de pausa. Si otra lectura usa el perfil, espera el turno. La migración `0034_notifications.sql` guarda el aviso y quién lo marcó leído. `0035_notification_first_seen.sql` añade `first_seen_at` si la tabla ya existía sin esa columna y, en ese caso, la rellena con `coalesce(first_seen_at, occurred_at, synced_at, now())`: la fecha del aviso va antes que `synced_at`, que es la última vez que se vio. `0036_notification_key_text.sql` quita el hash del texto de las claves antiguas sin id, se queda con la fila de `first_seen_at` más antiguo y copia las marcas de leído. No recorta una clave nueva de más de 120 caracteres. Un retoque del texto no crea otro aviso. Un chatter ve compras, propinas y suscripciones de los fans de sus cuentas, con el importe del fan. Las ganancias, el payout y el saldo de la agencia, y los tipos desconocidos, solo los ve la dueña. Lo que tiene fecha y supera 90 días se borra en la siguiente pasada. Un aviso sin fecha cuenta esos 90 días desde `first_seen_at`. En una fila nueva esa marca es el primer guardado y no se mueve si el aviso vuelve. Abrir la campana no lanza la visita.

La bandeja es de todas las cuentas. `listChatFanCards` usa `creatorIdsForChats` y devuelve la ficha de cada fan: gasto, compras, propinas, suscripción, renovación y estado, también de una cuenta que el chatter no tiene asignada. No devuelve ingresos totales, beneficios, pagos ni cifras agregadas del dashboard. Si un campo no viene, la ficha dice Sin datos.

En el Resumen, un chatter ve el número de fans activos de sus cuentas. No ve euros ni otros agregados: ni el bruto del día o del mes, ni ballenas, ni caídas. Las notificaciones no siguen el alcance de la ficha: un chatter solo ve las de las cuentas que tiene asignadas. La dueña, que es quien administra, las ve todas.

## Avisos de WhatsApp

Cuando entra un `new_fan_message`, Fanlink avisa a los miembros asignados a esa creadora que tengan el interruptor de avisos encendido y un teléfono en formato internacional. El texto lleva el nombre de la cuenta, el fan y el extracto. Varios fans del mismo momento salen en un solo mensaje. El mismo fan no se repite hasta que pasan los minutos guardados en su ficha (por defecto 15, `FANLINK_ALERT_QUIET_MIN`).

Sin credenciales el aviso es simulado y solo se escribe en el log, con el teléfono enmascarado. Para un proveedor real, sin pegar claves en el código:

- Twilio: `FANLINK_WHATSAPP_PROVIDER=twilio`, `FANLINK_TWILIO_ACCOUNT_SID`, `FANLINK_TWILIO_AUTH_TOKEN`, `FANLINK_TWILIO_WHATSAPP_FROM`.
- Cloud API: `FANLINK_WHATSAPP_PROVIDER=cloud`, `FANLINK_WHATSAPP_TOKEN`, `FANLINK_WHATSAPP_PHONE_ID`.

El teléfono y el interruptor se guardan en Equipo, en el acceso del servidor. No hace falta una clave de WhatsApp para probar el modo simulado.

## Masivos en borrador

En Campañas, el bloque «Borrador con fans sincronizados» arma un masivo con fans reales: activos, expirados, con gasto mínimo o sin interacción reciente. Se escribe el mensaje (`{nombre}`), el precio de PPV, los medios del vault, se ve la estimación y se puede programar. Guardar no envía.

Los masivos siguen sin enviarse a OnlyFans aunque `FANLINK_ENABLE_SEND=true`. Ese flag, junto con `FANLINK_SEND_ALLOW_ACCOUNTS`, solo abre el envío de un chat de las cuentas de la lista. El botón de Campañas dice **Envío real desactivado**.

El masivo nuevo (`of_mass_message`, migración `0027`) tampoco sale de aquí. Además de `FANLINK_ENABLE_SEND=true` hace falta `FANLINK_ENABLE_MASS_SEND=true` y la cuenta en `FANLINK_SEND_ALLOW_ACCOUNTS`. Las dos siguen apagadas si no se definen. Crear el borrador lo hace la dueña o quien tenga el permiso `masivos`. Un chatter no ve los ingresos ni el buy rate de ese masivo. Una pieza en una carpeta `NO VENDER` o `SIN EDITAR` (también `No-vender`, y lo mismo en una carpeta padre, o si la cadena de carpetas está rota o en ciclo) no sale ni en el envío de un chat ni en el masivo: lo corta el servidor, no solo el botón.

Lanzarlo son dos pasos y solo de un admin. El primero guarda el hash de un token y quién lo pidió. El token caduca a los 2 minutos según el reloj de la base, no según la hora que mande el cliente. El segundo paso lo presenta el mismo admin: la base lo consume en la misma sentencia que pasa el masivo a enviado, y solo si el hash coincide y aún no ha caducado. Un token vivo no se sustituye en silencio. Pasar a enviado no es un booleano que pueda marcar un chatter.

## Prueba local

El puerto 8080 puede estar ocupado. No lo uses si otro proyecto lo tiene.

Si ya hay una sesión guardada, no generes otra `FANLINK_SESSION_KEY`: la clave anterior es la que descifra `data/sessions`. En esa misma terminal:

```bash
git pull && npm install
npm run dev -- --port 8081 --host 127.0.0.1
```

La primera vez, sin sesión previa:

```bash
npm install
npx playwright install chromium
unset DATABASE_URL
export VITE_AUTH_ENABLED=false
export FANLINK_SESSION_KEY="$(openssl rand -base64 32)"
npm run dev -- --port 8081 --host 127.0.0.1
```

Abre `http://127.0.0.1:8081`. En Creadoras, Conectar abre Chromium. Comprobar puede tardar hasta medio minuto si la home no trae el usuario.

## Prueba en el Mac con OnlyFans real

Usa la clave que ya tienes. No generes otra. Misma terminal: Control+C, `git pull && npm install`, `npm run dev -- --port 8081 --host 127.0.0.1`. Abre `http://127.0.0.1:8081`.

1. **Creadoras.** El handle de la ficha debe ser el de la cuenta. Si Conexión sale Caducada o el texto dice que OnlyFans pide iniciar sesión, pulsa Reconectar. Entra tú, incluido el segundo factor. La ventana se cierra sola solo cuando `users/me` trae tu username. Luego Comprobar. La fila ya no tiene Sincronizar: muestra «Última sincronización: hace X min» y OK, en curso o un error corto. La dueña puede abrir Más y pulsar Forzar sincronización. Un miembro no ve ese botón.
2. **Automática.** Al arrancar el servidor, la primera pasada sale hacia el minuto. Luego sigue el intervalo (30 min si no lo cambias). En la terminal, una línea por pasada: cuenta, resultado, fans e ingresos. No salen cookies, tokens ni listas de URLs en la pantalla.
3. **Analítica.** La dueña ve ingresos, fans y el equipo. Un chatter, en Equipo, ve solo su bruto atribuido. No ve el de la agencia ni el de otro. El estado dice en curso, OK o error, y «Última sincronización: hace X min».
4. **Chat.** Conversaciones leídas, no el demo antiguo. La bandeja es la del CRM, no la página de OnlyFans. Solo la dueña ve Forzar sincronización. Hay caja de texto: Enter envía y Mayúsculas+Enter hace un salto de línea. El mensaje sale al momento como «Enviando…» y el borrador se vacía. Sin los flags, el botón Enviar está apagado y Enter dice «Envío real desactivado» sin encolar ni abrir el navegador. Con `FANLINK_ENABLE_SEND=true` y la cuenta en `FANLINK_SEND_ALLOW_ACCOUNTS`, el hilo muestra **Envío real** y el envío escribe en la caja nativa. Programar sigue guardando el envío en `of_chat_outbound` con autor y hora, sin mandarlo todavía. Un fallo dice «No se envió: motivo» y se puede reintentar a mano, con el mismo precio y las mismas piezas. Uno ya enviado no se reintenta. «Pendiente de confirmar» se ve en el hilo y no se reintenta; la dueña puede pulsar «Marcar como revisado». Si el navegador ya se abrió y falla, queda «Pendiente de confirmar». Un envío que sigue vivo renueva su lease y no se da por fallido aunque tarde más de 3 minutos. Si el proceso deja de latir, pasa a «Pendiente de confirmar» y no se reintenta. Si recargas con mensajes aún en la cola del navegador, el aviso de salida es el `beforeunload`. Cambiar de sección no vacía esa cola. Mientras la sesión carga, un usuario vacío no vacía esa cola. `reset()` solo corre cuando el cierre de sesión ha salido bien.
5. **Equipo.** Teléfono `+34…`, interruptor Avisos y minutos entre avisos. Sin claves de WhatsApp, el aviso sale como `simulado` en la terminal cuando un fan escribe.
6. **Campañas.** Borrador con fans sincronizados: vista previa y guardar. El botón dice «Envío real desactivado» y no se pulsa.
7. **Inicio, listas, vault y enlaces.** El ejemplo local de Inicio, listas y enlaces no son cifras de OnlyFans. «Add from media vault» abre el panel aunque no haya hilo. Con un chat abierto, cada clic lee una página de la bóveda real y no espera a que termine la escucha del chat. La lista sale de `vault/media` firmado (40 medios; en el primer clic también las listas). No abre Chromium para esa lista y no pulsa el compositor. Las miniaturas de esos 40 se piden con la URL recién leída, la cookie de la sesión y el mismo user-agent, y se guardan en memoria: como mucho 160 y 10 minutos, para que al cambiar de página no desaparezcan. Si el CDN responde 403 o 410, o la URL ya caducó (`Expires` o la Policy), se vuelve a leer `vault/media` una sola vez y se usa la URL nueva; no se pide una URL caducada. Si el fetch de Node sigue en 403 o 410, los bytes se piden una vez al dueño único del perfil (`borrowProfile`, que alquila `profiles.lease`) y se suelta el lease. Con ese dueño, un perfil ya abierto no lanza otro Chromium. Sin él, el `borrowProfile` de `f6b3729` (session-manager.ts:316-328) y el login (`runLogin`, :706-714) sí podían abrir un segundo Chromium sobre `data/profiles/<cuenta>`. La relectura de un medio usa la lista y el offset de su página, no siempre la página 0. Un GET suelto que sigue en 403/410 pide ese mismo perfil una vez, para no quedarse diez minutos en **Sin miniatura**. La caché cabe en 160 entradas o 24 MB, lo que se llene antes. La firma es la de `fetchSignedVault`: si cambia la firma de api2, las miniaturas la heredan. El cuadro sin foto dice **Sin miniatura**. El JSON del panel no lleva la URL del CDN. Es lectura, no el camino de Send, y Send sigue sin firmar ni llamar a `api2`. Si no llega ningún medio, sale el error. El panel del chat abre en Todo, no en el filtro que se quedó guardado. La bóveda (`/vault` y el panel del chat) lee el espejo `of_vault_item`: listas a la izquierda, grid a la derecha, filtros en el servidor. Si no hay filas, dice **Sin datos**. Un medio ya comprado se muestra aunque la ficha lo traiga bloqueado. Un chatter ve `salesCount`, «Ventas» y «Más vendido». No ve euros ni el total de la agencia. El precio sugerido sale de las compras de esa pieza a cualquier fan; si no hay ventas, **Sin datos**. El historial de precios sigue siendo el de ese fan.
8. **Reproducir un medio.** En el hilo, foto, vídeo o audio se piden a `GET /api/chat-media` (y la miniatura o el vídeo de la bóveda a `GET /api/vault-media`). Hace falta sesión. Sin sesión la respuesta es 401. La página no usa la URL del CDN. El servidor reenvía el `Range` como stream y no carga el archivo entero en memoria. El log `[fanlink:media]` lleva la cuenta y el id, no la URL. Si la miniatura no llega, el cuadro dice **Sin miniatura** y el servidor escribe `[fanlink:vault] miniatura status=` con el status real, sin la URL.
9. **Bandeja.** Mensajes es la bandeja del CRM. No se incrusta la página de OnlyFans.

## Datos

```
data/                         # gitignore
  accounts.json               # ficha de cada sesión (sin cookies), modo 0600
  profiles/<cuenta>/          # perfil de Chromium del login, modo 0700
  sessions/<cuenta>.json      # cookies y localStorage cifrados (AES-256-GCM), modo 0600
```

La tabla `of_session_account` (migración `migrations/0003_of_sessions.sql`) liga `creator_id` del CRM con el id de la sesión. Las cookies no van a la base de datos.

Con Postgres (`DATABASE_URL`) la tabla persiste. Sin esa variable el CRM usa el Postgres embebido de `data/pglite`. El archivo `data/accounts.json` también guarda el vínculo de la sesión, sin cookies.

## Variables

- `FANLINK_SESSION_KEY` — 32 bytes en base64 o hex. Obligatoria para guardar la sesión. No generes otra si ya hay `data/sessions`.
- `FANLINK_CHAT_MARK_READ` — `true` solo si al abrir un hilo en el CRM debe quedar leído en OnlyFans. Sin esta variable no se manda ese POST. La cuenta tiene que estar también en `FANLINK_SEND_ALLOW_ACCOUNTS`. Un 200 baja el no leído a 0 para todo el equipo. La lista y el respaldo no marcan leído.
- `FANLINK_ENABLE_SEND` — `true` solo si vas a enviar chats de verdad. Sin esta variable, o con otro valor, no se envía nada.
- `FANLINK_SEND_ALLOW_ACCOUNTS` — ids o handles de las creadoras que sí pueden enviar. Ejemplo de la cuenta de prueba: `9ikis52,@bigpoppa1111`. El resto sigue apagado. La misma lista abre la pestaña OnlyFans en directo.
- `FANLINK_LIVE_VIEW_ENABLED` — `true` solo para ver la página real de OnlyFans dentro del CRM. Sin esta variable sigue apagada y Mensajes es la bandeja del CRM: no se borra. Teclear y subir archivos exigen también `FANLINK_ENABLE_SEND=true`; si no, la pestaña es solo lectura. El socket solo existe con `npm run dev`. En el proceso de despliegue (`node .output/server`) no hay directo: se queda la bandeja.
- `FANLINK_LIVE_FPS` — fotogramas del screencast, de 1 a 8. Por defecto 4. Hay como máximo 4 visores.
- `FANLINK_LIVE_QUALITY` — calidad JPEG, de 20 a 80. Por defecto 40.
- `FANLINK_LIVE_IDLE_MS` — suelta el control si quien lo tiene no toca la pestaña. Quien solo mira sigue dentro. Por defecto 90 segundos.
- `FANLINK_LIVE_GRACE_MS` — una sala en directo sin visores se cierra tras esta espera y suelta el perfil. Por defecto 60 segundos, entre 0 y 30 minutos. `FANLINK_LIVE_ROOM_GRACE_MS` sigue valiendo (hasta 120 segundos) si la otra no está.
- `FANLINK_SEND_PER_MINUTE` — tope de envíos de una cuenta en un minuto. Por defecto 4. Entre 1 y 30.
- `FANLINK_DATA_DIR` — por defecto `./data`.
- `FANLINK_LOGIN_TIMEOUT_MS` — por defecto 15 minutos.
- `FANLINK_OPEN_LOGIN_ON_INVALIDATE=true` — reabre Chromium si la sesión deja de valer. En el CRM, el valor por defecto es no reabrir.
- `DISPLAY` o `WAYLAND_DISPLAY` — escritorio para la ventana de login.

La ventana de Conectar sigue siendo visible. Comprobar, sincronizar, escuchar, la sala en directo, la bóveda, los fans en línea, el menú del fan y el envío piden el perfil a un solo dueño: no hay dos Chromium abiertos a la vez sobre `data/profiles/<cuenta>`. Reconectar cierra antes la sala y espera como mucho 25 s (`FANLINK_PROFILE_IDLE_MS`) a que terminen las lecturas que ya tienen el perfil: no cierra el navegador debajo de ellas. Si siguen, no abre la ventana y lo dice. Fans en línea son los suscriptores activos con el filtro En línea. La lista sale de `GET /api2/v2/subscriptions/subscribers?type=active&filter[online]=1` firmada, sin abrir Chromium. Un 401 dice que OnlyFans ha rechazado la firma. Solo un 200 con la lista vacía dice «Nadie en línea». Si no hay JSON, se abre Colecciones en la pestaña Todo y se pulsa Filtros → En línea. No se abre la lista «Fans» de user-lists. No usa la página de la escucha. Si Conectar está abierto o el perfil está ocupado, responde enseguida y no se queda en «Leyendo…». Al soltar el perfil se reescribe `data/sessions/<cuenta>.json` (modo 0600) con las cookies actuales, incluida `sess` si OnlyFans la rotó. Al reabrir, no se repone una cookie más vieja que la que el perfil ya tiene. El trabajo de fondo sigue en segundo plano. `FANLINK_HEADFUL=true` lo deja visible solo para depurar. El user agent, el viewport, el idioma `es-ES` y la zona `Europe/Madrid` no cambian. No basta el archivo de cookies: OnlyFans puede tratar un navegador distinto como invitado y pedir login (`users/me` sin username, `webauthn/login` o `/posts/login`). La sesión solo se guarda cuando `users/me` trae un username. Si pide iniciar sesión, Conexión pasa a **Caducada** y el texto es «OnlyFans pide iniciar sesión: pulsa Reconectar». Las rutas vistas quedan en el log del servidor. El envío escribe `[fanlink:send] inicio`, `navegado`, `escrito`, `click`, `confirmado` o `error motivo=…`, sin el texto del mensaje.

El proxy de cada cuenta, Postgres y WhatsApp en un VPS están en `DEPLOY.md`.

## Pruebas

```bash
npm test
npm run typecheck
```

Bóveda y reproducción, en local, sin envío real (los flags no se exportan):

```bash
npm run dev
```

Abre `http://127.0.0.1:8080/vault` y, en un chat, `http://127.0.0.1:8080/mensajes`. Pulsa **Add from media vault** y **Leer vault de OnlyFans**: lo leído se guarda en el espejo y el grid lo enseña. Sin filas sale **Sin datos**. En dos páginas distintas tiene que verse al menos una miniatura, y la sesión sigue en **Activa**. Si una foto no tiene miniatura, el cuadro dice **Sin miniatura**, no se queda en blanco. Un vídeo de la bóveda usa `GET /api/vault-media?...&variant=full` y el del hilo `GET /api/chat-media`, los dos con `Range`. Sin sesión responden 401. El envío de una pieza solo sale si `FANLINK_ENABLE_SEND=true` y la cuenta está en la allowlist; si no se exportan, sigue apagado. El navegador no manda el título: solo salen ids que ya están en el espejo y no son NO VENDER. Antes de pulsar Send se comprueba que cada pieza quedó en el compositor. Si el título está vacío, se repite o no se puede distinguir por id o carpeta, no se envía.

El login, la restauración, la caducidad y el cifrado se prueban contra un sitio local con el mismo contrato, no contra OnlyFans.
