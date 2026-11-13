/**
 * La lectura del centro ya no abre el navegador.
 * La hace of-notifications-api.ts con api2 firmada. Este módulo solo
 * reexporta el resultado para no dejar un segundo camino.
 */
export type { CollectedNotifications } from "./of-notifications-api.ts";
