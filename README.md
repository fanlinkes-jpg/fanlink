# Fanlink

CRM (Vite, React 19, TanStack Router) y sesiones de OnlyFans. La guía de uso está en [LEEME.md](LEEME.md).

El personal entra con better-auth. La cuenta de OnlyFans no se teclea en Fanlink: **Conectar** abre Chromium y la dueña inicia sesión en esa ventana. Las cookies se guardan cifradas con `FANLINK_SESSION_KEY`.

```bash
npm install
npx playwright install chromium
export FANLINK_SESSION_KEY="$(openssl rand -base64 32)"
npm run dev
```

La consola queda en `http://127.0.0.1:8080`. Creadoras muestra **Activa**, **Pendiente de login** o **Expirada**. En Linux hace falta un escritorio (`DISPLAY` o `WAYLAND_DISPLAY`) para la ventana.

```bash
npm test
npm run typecheck
```
