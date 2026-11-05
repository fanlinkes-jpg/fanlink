export const messages = {
  loginTimeout: "El tiempo de espera terminó antes de llegar al dashboard",
  loginClosed: "La ventana de login se cerró antes de llegar al dashboard",
  loginCancelled: "El login se canceló",
  sessionInvalid: "OnlyFans ha invalidado la sesión",
  loginRequired: "OnlyFans pide iniciar sesión: pulsa Reconectar",
  cookiesExpired: "Las cookies de la sesión han caducado",
  noSession: "No hay sesión guardada",
  loginInProgress: "El login está en curso en la ventana del navegador",
  displayRequired:
    "Hace falta un escritorio gráfico (variable DISPLAY) para abrir la ventana de login.",
  credentialsRejected:
    "Fanlink no acepta credenciales. Inicia sesión en la ventana del navegador.",
  browserMissing:
    "No está instalado Chromium para Playwright. Ejecuta: npx playwright install chromium",
  inconclusive:
    "OnlyFans mostró un reto anti-bot. La sesión guardada no se ha descartado.",
  missingKey: "Falta FANLINK_SESSION_KEY. La sesión no se guarda en claro.",
  labelRequired: "El nombre de la cuenta es obligatorio",
  labelLength: "El nombre debe tener entre 1 y 80 caracteres",
  invalidUrl: "URL no válida",
  urlCredentials: "La URL no puede incluir credenciales",
  originRejected: "La petición tiene que ir al sitio de la cuenta",
  methodRejected: "Solo se permiten peticiones GET",
  internal: "Error interno",
} as const;

export function publicErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const firstLine = error.message.split("\n")[0] ?? fallback;
  return firstLine.slice(0, 300);
}
