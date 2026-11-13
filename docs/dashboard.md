# Dashboard

Estructura de pantallas del CRM, al estilo de un panel de agencia (menú lateral, cuenta, rango y widgets por rol). Esta versión solo lee lo que Fanlink ya ha sincronizado. No firma peticiones, no llama a la API de OnlyFans y no inventa una cifra: si el dato no está guardado, el widget dice **Sin datos**.

En `main` no hay módulos llamados M1–M6. El dashboard no crea otra fórmula. Reutiliza:

| Dato | Función que ya existe |
| --- | --- |
| Ingresos, serie, fans activos, variación | `creatorReport` y `changeRatio` (`src/lib/creator-metrics.ts`) |
| Suscripciones, tips y PPV | `syncedKindGross` en el mismo módulo. El PPV sincronizado se guarda como tipo `message` (el lector de estados mapea `ppv` a `message`). No se suma otra vez aparte. |
| Alertas de sesión, sincronización, ballena y caída | `dashboardAlerts` (`server/of-sessions/metrics/dashboard.ts`), ya calculadas por `listDashboard` |
| Segmentos y gasto del fan (pantalla Fans, fase siguiente) | `fanProfiles` y `rankFans` |
| Ventas atribuidas y tiempo de respuesta (pantalla Chatters, fase siguiente) | `chatterReports`, `presentTeamMetrics` y `employeeMetricCells` |

`presentTeamMetrics` ya esconde el bruto de los demás chatters. Un chatter ve el suyo; la dueña ve el de todas.

## Layout

La entrada es `/`. Dentro del marco actual de la app hay un segundo nivel, el del dashboard:

- **Menú lateral** (en móvil, una fila desplazable): Resumen, Creadoras, Fans, Chatters, Campañas y Ajustes.
- **Creadora.** La dueña elige una cuenta o Todas. Un chatter solo ve las cuentas que la dueña le asignó (`creator_grant`). Si el selector global apunta a una cuenta que no es suya, el dashboard vuelve a las suyas. Sin asignación, no hay cuentas y los widgets quedan en Sin datos.
- **Rango.** Hoy, 7 días o Mes. Son los periodos de `creatorReport` (`day`, `week`, `month`), en hora de Madrid. El rango recorta ingresos, suscripciones, PPV, tips y la tendencia. Los fans activos son el stock sincronizado, no un alta del periodo.
- **Rol.** Dueña (`owner`) o chatter (`member` en el acceso del equipo).

El chat, el envío y los masivos no forman parte de este menú. Siguen en sus pantallas.

## Quién ve cada pantalla

| Pantalla | Dueña | Chatter |
| --- | --- | --- |
| Resumen | Sí | Sí, solo sus cuentas y sin importes |
| Creadoras | Sí | Sí, solo sus cuentas |
| Fans | Sí | Sí, solo sus cuentas |
| Chatters | Sí | Sí. El bruto ajeno no sale de `presentTeamMetrics` |
| Campañas | Sí | Solo con permiso `campanas` |
| Ajustes | Sí. Aquí se configuran los widgets | No |

Los importes (ingresos, suscripciones, PPV, tips, tendencia, ingresos por creadora y resultado de campaña) quedan fuera del chatter aunque la configuración diga lo contrario. La función `widgetsFor` los quita y `buildSummary` no rellena esos importes si el rol no es dueña.

## Widgets

El orden de la tabla es el orden por defecto. La dueña puede ocultar, reordenar y elegir el rol. Un widget de importe no admite el rol chatter.

### Resumen (fase 1, con cifras)

| Id | Qué muestra | Origen | Rol por defecto |
| --- | --- | --- | --- |
| `ingresos` | Bruto del rango | `creatorReport.grossCents`. La variación usa `changeRatio` solo si hay periodo anterior | Dueña |
| `suscripciones` | Bruto del tipo `subscription` | `syncedKindGross` | Dueña |
| `ppv` | Bruto del tipo `message` | `syncedKindGross`. Es el PPV ya guardado, no un segundo cálculo | Dueña |
| `tips` | Bruto del tipo `tip` | `syncedKindGross` | Dueña |
| `mensajes` | Conteo de mensajes | No hay un conteo sincronizado distinto del PPV. Siempre **Sin datos** | Dueña y chatter |
| `fans-activos` | Fans con estado activo | `creatorReport.activeFans`. Sin fila de fans sincronizada: **Sin datos** | Dueña y chatter |
| `tendencia` | Serie del rango | `creatorReport.series`. Sin puntos: **Sin datos** | Dueña |
| `alertas` | Avisos de las cuentas visibles | Alertas de `listDashboard`, recortadas al nombre o a la etiqueta de esas cuentas. Sin respuesta: **Sin datos**. Lista vacía: Sin alertas | Dueña y chatter |

Si hay transacciones en el rango, el tipo sale de ellas. Si no hay transacciones y los estados sí se sincronizaron, el tipo sale de la fila diaria de ese `kind`. Cero guardado se muestra como `$0.00`. Ausencia de fila es **Sin datos**, no un cero.

### Creadoras, Fans, Chatters y Campañas

En esta fase el menú abre la pantalla, enseña los widgets configurados y deja el valor en **Sin datos**. No se copia la tabla de Analítica ni la de Equipo. El detalle que ya existe sigue en su ruta:

| Pantalla | Widgets | Ruta que ya tiene el detalle |
| --- | --- | --- |
| Creadoras | `creadoras-cuentas`, `creadoras-ingresos` (solo dueña) | `/creadoras` |
| Fans | `fans-segmentos` (`whale`, `risk`, `asleep`, `new` de `fanProfiles`), `fans-ltv` | `/analitica` |
| Chatters | `chatters-ventas`, `chatters-respuesta` | `/equipo` |
| Campañas | `campanas-estado`, `campanas-resultado` (solo dueña) | `/campanas` |

La pantalla Fans usará los segmentos ya definidos en `fanProfiles`. La de Chatters usará la atribución de `chatterReports` (una venta con un solo autor) y la media de primera respuesta. Hasta que esas pantallas lean esas funciones, no muestran un número.

Analítica (`AnalyticsPage` en `src/features/control-pages.tsx`) y Creadoras (`CreatorsPage`, en el mismo fichero) llaman a `useOfReads()` sin argumento. Ese es el alcance del dashboard. El servidor lo decide por el rol: un chatter solo recibe fans, gasto del fan y estado de sincronización de las cuentas asignadas, aunque el navegador pida `scope: "chat"`. Las cifras de la agencia siguen en null para un chatter. La ficha de la bandeja no usa ese alcance: `listChatFanCards` recorre `creatorIdsForChats` y trae gasto, compras, propinas, suscripción, renovación y estado de cualquier cuenta. No trae ingresos totales, beneficios, pagos ni el dashboard agregado.

## Configuración

La dueña, en Ajustes del dashboard, cambia tres cosas por widget:

- si se ve (`visible`);
- el orden dentro de su pantalla (subir o bajar);
- para qué rol (`owner`, `chatter` o los dos).

El objeto guardado es:

```ts
type DashboardConfig = {
  version: 1;
  widgets: Array<{
    id: string;
    visible: boolean;
    order: number;
    roles: Array<"owner" | "chatter">;
  }>;
};
```

`normalizeDashboardConfig` descarta ids desconocidos, rellena los que falten con el defecto, deja un orden único por pantalla y fuerza `roles: ["owner"]` en los widgets de importe. Una configuración a medias, o una fila vieja sin este campo, equivale al defecto.

## Dónde se guarda

En la fila compartida `workspace_state.state`, campo `dashboardConfig`, la misma persistencia que creadoras, fans y ajustes. El cliente la manda en `snapshot`. La dueña puede cambiarla. Un miembro no: `assertWorkspaceChange` lo rechaza aunque tenga permiso de ajustes.

Una fila anterior no trae el campo. Compararla con el defecto no cuenta como cambio, así un chatter puede seguir guardando su trabajo sin pisar una configuración que aún no existe. El rango de fechas y la creadora elegida no se guardan en esa fila: el rango es de la visita y la creadora sigue siendo el selector que ya usa el CRM.

Abrir el dashboard no lanza una sincronización. Lee `listDashboard`, las lecturas ya guardadas y el estado de sesión.

## Centro de notificaciones

Cada creadora tiene una campana. El contador son las no leídas de esa cuenta. El panel lista lo que ya se escuchó de su página de notificaciones, de todos los tipos que esa página haya pedido: me gusta, comentarios, etiquetas (también pendientes o faltantes), suscripciones, renovaciones, propinas, compras de PPV, mensajes y avisos. Si un campo no viene, se queda en **Sin datos**. No se inventa un importe a cero.

Las pestañas son las de OnlyFans, en este orden y en español: Todo, Suscripciones, Compras, Propinas, Etiquetas, Comentarios, Menciones, Me gusta, Promociones y OnlyFans. Cada una muestra el contador de no leídas de `GET /api2/v2/users/notifications/count`. La burbuja es el total `all`. Hay búsqueda, rango de fechas (día de Madrid) y marcar como leída. Eso último es del CRM: no se escribe en OnlyFans. La fecha es relativa («hace 3 d»), calculada con el reloj de la lectura, no un cubo de 24 h. Si la fila trae fan o hilo, Abrir lleva a la consola de mensajes de esa cuenta. Si no trae ninguno, el destino es **Sin datos**.

Un chatter ve las notificaciones de las cuentas que tiene asignadas, y en el servidor, no solo en el navegador. Ve la compra, la propina y la suscripción de cada fan de esas cuentas, con el importe que ese fan gastó. No ve cifras de la agencia (ingresos totales, ganancias, payout, saldo) ni un tipo desconocido, sobre todo si trae importe: eso queda en la dueña. Las alertas del Resumen también se recortan en el servidor a las cuentas asignadas.

Marcar como leída es de cada persona, no de la cuenta: si un chatter la marca, la dueña sigue viéndola nueva. El listado va de 50 en 50, y el recorte por rol se hace en la consulta, antes del límite. Lo que tiene fecha y pasa de 90 días se borra en la siguiente escucha. Un aviso sin fecha cuenta esos 90 días desde la primera vez que se vio. Si el filtro de fechas deja fuera avisos sin fecha, salen aparte con el aviso «Sin fecha».

La clave de un aviso sin id es la fecha, el tipo, el fan y el hilo. No lleva el texto: si OnlyFans lo retoca, no sale un duplicado. Dos avisos distintos con la misma fecha, tipo, fan e hilo se quedan en uno. Sin id y sin fecha no hay clave. Si la clave pasa de 120 caracteres, el resto es un SHA-256 recortado. Esa huella sale de `createHash('sha256')` de Node `>=22.3`; la campana no la calcula. `0036_notification_key_text.sql` reescribe las claves antiguas que sí llevaban el hash y borra el duplicado. Un aviso de agencia o desconocido no pasa después a un tipo que vea el chatter.

### Escucha

Se firma y se llama a api2. No se abre Chromium. El planificador, aparte del de ingresos y del de chats, pide la primera página del centro cada 45 segundos y solo si la cuenta está Activa y tiene sesión guardada. Un solo lector por cuenta y 300 ms entre medias. Las rutas son las del cliente web: `/api2/v2/users/notifications/count`, `/api2/v2/users/notifications?limit=10&format=infinite` y `/api2/v2/release-forms/mentions` para Etiquetas. Un 401 es sesión caída y no hay un ping a `/users/me` en cada ciclo. Un 400 muestra «Firma rechazada». Si no hay avisos, «Sin notificaciones». El log es `[fanlink:notif]` con la creadora, el número, el motivo y el status, sin cookies ni secretos. La migración es `0034_notifications.sql`. `0044_notification_counts.sql` añade los contadores. `0035_notification_first_seen.sql` añade `first_seen_at` si faltaba y, en las filas viejas, la rellena con `coalesce(first_seen_at, occurred_at, synced_at, now())`.

Abrir la campana no lanza esa visita. Lee `of_notification`.

### Montaje en el chat

Esta rama no edita la consola. El componente es `NotificationBell` en `src/features/notification-bell.tsx`. En la cabecera de la creadora, dentro de `src/features/real-chats.tsx`, el punto de montaje es:

```tsx
<NotificationBell
  creatorId={creatorId}
  onOpenThread={({ creatorId: id, fanKey, threadKey }) => {
    // Abrir el hilo de esa cuenta. fanKey o threadKey pueden ser null.
  }}
/>
```

En el dashboard la campana sale al elegir una sola creadora, no en Todas.
