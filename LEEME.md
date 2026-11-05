# Fanlink

CRM de la agencia y sesiones de OnlyFans. El equipo entra en Fanlink con su propia cuenta. La cuenta de OnlyFans la abre la dueña en una ventana de Chromium: Fanlink no pide ni guarda esa contraseña.

## Sesión del equipo y sesión de OnlyFans

Son dos cosas distintas.

- **Equipo.** better-auth, en `/login`. Es quien puede ver el CRM y pulsar Conectar.
- **OnlyFans.** Playwright abre Chromium con un perfil por creadora. Cuando la página llega al feed, se guardan cookies y localStorage cifrados. No hay formulario de contraseña en Fanlink.

## Cómo ejecutarlo

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

**Sincronizar**, en Creadoras o en Analítica, abre con la sesión guardada las páginas normales `https://onlyfans.com/my/statements/earnings` y `https://onlyfans.com/my/subscribers/active`. El listener se registra antes de navegar. Se guardan solo los campos que el JSON o el DOM dejan leer: día e importes por suscripciones, propinas, mensajes y posts; fans con id, handle, nombre, fecha, estado y gasto si viene. Hay pausas, como mucho tres desplazamientos y una cuenta cada vez. No se envía nada ni se llama a un endpoint por nuestra cuenta.

Fragilidad: si OnlyFans cambia esas páginas, los nombres de los campos o deja de pedir ese JSON, la sincronización no inventa cifras. La razón puede ser `sin respuesta de ingresos`, `sin respuesta de fans`, `página cambiada` o `redirigido a login`, con las rutas JSON sin query. Los ingresos solo los ve la dueña. Un chatter ve los fans de las cuentas que tiene asignadas, sin totales de la agencia. Si la identidad es **No coincide**, no se sincroniza.

Hasta que exista una sincronización, Analítica y Fans muestran **Sin sincronizar**. El origen guardado es `onlyfans`. Abrir la pantalla solo lee lo guardado: no lanza una sincronización.

El servidor sincroniza solo cada cuenta con sesión activa. Por defecto cada 30 minutos (`FANLINK_SYNC_INTERVAL_MIN`). La dueña puede cambiarlo en Analítica, entre 5 y 1440 minutos; ese valor guardado manda sobre la variable. Va de una en una, con un margen al azar de 15 a 90 segundos entre cuentas. No entra una cuenta con identidad **No coincide**, ni una sesión caducada o sin guardar. Si esa cuenta ya se está sincronizando (también a mano), no se lanza otra. Tras dos fallos seguidos la siguiente espera es el doble, luego el cuádruple, hasta 16 veces el intervalo. `FANLINK_SYNC_ENABLED=false` apaga el planificador. En la fila se ve «Última sincronización: hace X min» y el estado: en curso, OK o error con el motivo.

## Chats, solo lectura

El mismo planificador abre `https://onlyfans.com/my/chats` y, como mucho, dos hilos recientes. Escucha el JSON que esas páginas piden (`/chats`, `/messages`) y, si no hay, marcadores del DOM. No envía mensajes. Por defecto cada 2 minutos (`FANLINK_CHAT_SYNC_MIN`, de 1 a 30). La dueña lo cambia en Analítica, en «Chats cada». Usa el mismo turno que ingresos: una cuenta cada vez, sin repetir la que ya está en curso, y sin entrar si la identidad no coincide o la sesión está caducada.

Los hilos y los mensajes se guardan por creadora y por fan. Un mensaje nuevo de un fan crea el evento interno `new_fan_message` (creadora, fan, extracto, hora) y una línea en el log. La segunda lectura del mismo mensaje no lo repite. Chat muestra solo lo guardado; un chatter ve las cuentas que tiene asignadas. Abrir Chat no sincroniza. El botón **Sincronizar chats** fuerza esa lectura.

Fragilidad: si OnlyFans cambia la ruta del chat o los campos `withUser`, `lastMessage`, `text` y `createdAt`, la lista puede quedar vacía y la razón será `sin respuesta de chats` o `página cambiada (chats)`. El envío no existe en esta versión.

## Avisos de WhatsApp

Cuando entra un `new_fan_message`, Fanlink avisa a los miembros asignados a esa creadora que tengan el interruptor de avisos encendido y un teléfono en formato internacional. El texto lleva el nombre de la cuenta, el fan y el extracto. Varios fans del mismo momento salen en un solo mensaje. El mismo fan no se repite hasta que pasan los minutos guardados en su ficha (por defecto 15, `FANLINK_ALERT_QUIET_MIN`).

Sin credenciales el aviso es simulado y solo se escribe en el log, con el teléfono enmascarado. Para un proveedor real, sin pegar claves en el código:

- Twilio: `FANLINK_WHATSAPP_PROVIDER=twilio`, `FANLINK_TWILIO_ACCOUNT_SID`, `FANLINK_TWILIO_AUTH_TOKEN`, `FANLINK_TWILIO_WHATSAPP_FROM`.
- Cloud API: `FANLINK_WHATSAPP_PROVIDER=cloud`, `FANLINK_WHATSAPP_TOKEN`, `FANLINK_WHATSAPP_PHONE_ID`.

El teléfono y el interruptor se guardan en Equipo, en el acceso del servidor. No hace falta una clave de WhatsApp para probar el modo simulado.

## Masivos en borrador

En Campañas, el bloque «Borrador con fans sincronizados» arma un masivo con fans reales: activos, expirados, con gasto mínimo o sin interacción reciente. Se escribe el mensaje (`{nombre}`), el precio de PPV, los medios del vault, se ve la estimación y se puede programar. Guardar no envía.

`FANLINK_ENABLE_SEND` está apagado. El botón dice **Envío real desactivado** y no se puede pulsar. Aunque se activara, el servidor no envía a `onlyfans.com`. El adaptador del navegador solo se prueba contra el sitio local de pruebas.

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

Abre `http://127.0.0.1:8081`. En Creadoras, Conectar abre Chromium. Comprobar puede tardar hasta medio minuto si la home no trae el usuario. No se leen métricas ni se envían mensajes.

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

- `FANLINK_SESSION_KEY` — 32 bytes en base64 o hex. Obligatoria para guardar la sesión.
- `FANLINK_DATA_DIR` — por defecto `./data`.
- `FANLINK_LOGIN_TIMEOUT_MS` — por defecto 15 minutos.
- `FANLINK_OPEN_LOGIN_ON_INVALIDATE=true` — reabre Chromium si la sesión deja de valer. En el CRM, el valor por defecto es no reabrir.
- `DISPLAY` o `WAYLAND_DISPLAY` — escritorio para la ventana de login.

La ventana de login no es headless. Las comprobaciones en segundo plano, si se lanzan, usan el JSON cifrado.

## Pruebas

```bash
npm test
npm run typecheck
```

El login, la restauración, la caducidad y el cifrado se prueban contra un sitio local con el mismo contrato, no contra OnlyFans.
