# Fanlink

Gestión local de sesiones de OnlyFans. Cada cuenta tiene su propio perfil de Chromium y un archivo JSON con el storage state. Fanlink no pide ni guarda usuario ni contraseña.

## Flujo

1. Al añadir una cuenta, se abre una ventana visible de Chromium con el perfil de esa cuenta.
2. La persona escribe el usuario y la contraseña en onlyfans.com. Si aparece un captcha o un doble factor, lo resuelve en esa misma ventana.
3. Cuando la página llega al feed (`/`) o a `/my/…`, hay cookies `auth_id` y `sess`, y el formulario de acceso ya no está, Fanlink exporta cookies y localStorage a `data/sessions/<cuenta>.json`.
4. Al arrancar, y en cada petición posterior al sitio, ese JSON se carga en un contexto nuevo. No se vuelve a autenticar.
5. Si OnlyFans rechaza la sesión, el indicador pasa a **Pendiente de login** y se reabre la ventana para repetir el acceso.

## Estados

| Indicador | Significado |
| --- | --- |
| Activa | El storage state se restauró y el sitio lo aceptó. |
| Pendiente de login | No hay sesión, o la ventana de acceso está abierta. |
| Expirada | La sesión guardada ya no sirve y la ventana de acceso no está abierta. |

Si las cookies caducan o el sitio invalida la sesión con la reapertura automática activa, el estado visible pasa a pendiente y se abre Chromium. Si esa ventana se cierra sin llegar al dashboard, el indicador queda en expirada.

## Datos

```
data/
  accounts.json
  profiles/<cuenta>/    # perfil persistente, modo 0700
  sessions/<cuenta>.json # cookies y localStorage, modo 0600
```

Esa carpeta contiene sesiones vivas. No la subas a git. El servidor escucha en `127.0.0.1` por defecto.

En Linux hace falta un escritorio (`DISPLAY` o `WAYLAND_DISPLAY`) para la ventana de login.

## Uso

```bash
npm install
npx playwright install chromium
npm start
```

Abre `http://127.0.0.1:8787`. El nombre de la cuenta es solo una etiqueta.

Variables:

- `PORT`
- `HOST` (por defecto `127.0.0.1`)
- `FANLINK_DATA_DIR`
- `FANLINK_LOGIN_TIMEOUT_MS` (por defecto 15 minutos)
- `FANLINK_OPEN_LOGIN_ON_INVALIDATE=false` deja la sesión en expirada en vez de reabrir la ventana

La ventana de login no tiene modo headless. Las comprobaciones en segundo plano sí usan un contexto sin ventana, siempre a partir del JSON guardado.

## API

- `GET /api/accounts`
- `POST /api/accounts` con `{ "label": "Nombre" }`
- `POST /api/accounts/:id/login`
- `POST /api/accounts/:id/probe`
- `POST /api/accounts/:id/requests` con `{ "url": "https://onlyfans.com/..." }`

Cualquier campo de credencial (`password`, `username`, `email`, `cookie`) se rechaza. Las peticiones solo pueden ir a `onlyfans.com`.

## Pruebas

```bash
npm test
npm run typecheck
```

Las pruebas de extremo a extremo usan un sitio local con el mismo contrato (login manual, redirección al dashboard, storage state y restauración). No inician sesión en OnlyFans.
