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

Hasta que exista una sincronización, Analítica y Fans muestran **Sin sincronizar**. El origen guardado es `onlyfans`.

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
