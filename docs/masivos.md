# Masivos

Fase 1 de los mensajes masivos de Fanlink. Se compone, se segmenta y se simula. No se envía nada.

El borrador antiguo de Campañas (`of_campaign_draft`) sigue igual. Esta fase no toca el chat ni el envío 1 a 1.

## Qué no hace

- No firma peticiones ni llama a la API de OnlyFans.
- No lee ni escribe la clave de cifrado de la sesión.
- El envío real está apagado. Hace falta `FANLINK_ENABLE_SEND=true`, `FANLINK_ENABLE_MASS_SEND=true` y que la cuenta esté en `FANLINK_SEND_ALLOW_ACCOUNTS` (ids separados por comas). Cualquier otro valor deja la compuerta cerrada.
- Lanzarlo, además, lo confirma un admin dos veces: el id del masivo y la frase `ENVIAR MASIVO`. Crear el borrador lo puede hacer la dueña o quien tenga el permiso `masivos`.
- Aunque la compuerta se abra, `dryRunMass` devuelve `delivered: false` y `network: "sin-llamada"`. No hay transporte.

## Modelo

Un masivo es una fila de `of_mass_message` (migración `0027`). En código es `MassDraft`.

| Campo                               | Significado                                                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `creator_id`                        | Cuenta. En el dominio se llama `accountId`.                                                                                                                                                                                                                  |
| `body` / `body_json`                | Texto plano y el mismo texto en trozos con marca: negrita, cursiva, subrayado, tachado. `{nombre}`, `{nombrecompleto}` y `{usuario}` se rellenan con el fan sincronizado. Si el nombre o el usuario no están, el token se queda y la vista dice «Sin datos». |
| `price_cents`                       | `null` es gratis. Un PPV es un entero de 3 a 200 USD (300–20000 céntimos).                                                                                                                                                                                   |
| `vault_ids` / `preview_vault_ids`   | Arrays JSON de la bóveda. La vista previa es un subconjunto y solo existe en un PPV.                                                                                                                                                                         |
| `scheduled_at`                      | Cuándo empezaría la cola. Vacío: se simula desde «ahora».                                                                                                                                                                                                    |
| `segment_json`                      | Audiencia de abajo.                                                                                                                                                                                                                                          |
| `unsend_after_hours`                | Plan, de 1 a 168 horas, para quitar lo no comprado. No se ejecuta.                                                                                                                                                                                           |
| `follow_up_json`                    | Texto para quien no compre, pasado ese plazo. Los destinatarios salen «Sin datos» hasta que haya un registro de envío.                                                                                                                                       |
| `created_by_id` / `created_by_name` | Chatter que lo creó. Si falta, la estadística dice «Sin datos».                                                                                                                                                                                              |
| `rotate` / `exclude_bought`         | Por defecto activos si hay media.                                                                                                                                                                                                                            |
| `idempotency_key`                   | Estable en el mismo clic. Un segundo guardado con la misma clave y cuenta no crea otra fila.                                                                                                                                                                 |
| `status`                            | `draft`, `scheduled`, `held` (palabra prohibida), `cancelled`, `sent` o `retry`.                                                                                                                                                                             |

La audiencia lee un `MassSnapshot`, no la red:

- Fans: `of_fan_read` (`status`, `spent_cents`, nombre, handle).
- Actividad: último mensaje del fan en `of_chat_message`.
- Gasto a 30 días y última compra: `of_transaction`, con la misma regla de cobertura que el perfil del fan. Si el historial no cubre la ventana, el importe es null y ese fan no entra en el tramo.
- Precio y compra de PPV: `price_cents` y `purchased` del chat. `purchased` null no cuenta como compra ni como no compra.
- Listas de OnlyFans, qué medio iba en cada mensaje y cuántos masivos lleva la cuenta hoy: el sync no los trae. En el snapshot van `null`.

Los colores de gasto son los de `src/lib/spend-tiers.ts`: 0 gris, hasta 50 USD verde, hasta 200 azul, hasta 1000 morado y por encima dorado. El masivo puede recibir otros cortes, pero el defecto es ese. Ballena no es el dorado: es el mismo corte de 100 USD que el perfil del fan.

`lifetime` usa `spent_cents`. `spend30` usa los 30 días cubiertos.

## Flujo

1. `composeMass` valida texto, media, precio, horario, unsend, follow-up y que haya una audiencia. Sin audiencia explícita (`includeAll` u otro filtro) no hay borrador.
2. `resolveSegment` cruza la audiencia. Todas las condiciones de entrada se suman. Luego se restan exclusiones manuales, listas, quien ya compró ese medio y quien ya lo recibió.
3. `suggestPrice` mira los PPV comprados del segmento (mediana, redondeada al dólar, dentro de 3–200). `bestSendHour` mira la hora UTC en la que escriben esos fans. Si no hay casos, «Sin datos». No se propone una hora ni un precio por defecto.
4. `buildQueue` ordena a ritmo humano: pausa de 45–90 s según el fan, tope de 30 por hora y 200 por día, en la zona horaria de la cuenta. Es una política de Fanlink, no un cupo medido. Si no hay uso sincronizado o no hay zona, no se coloca a nadie: no se supone que el uso es 0. Los fans repetidos se quedan una sola vez. Lo que pasa del tope del día queda en espera; no se programa al día siguiente.
5. `dryRunMass` devuelve la vista. `massStats` solo cuenta un registro de entregas. La longitud de la cola no es «enviados».

Si falta un dato necesario para no pasarse de audiencia, la cola queda vacía y el estado es `sin_datos`:

- Pedir una lista de OnlyFans sin catálogo.
- Adjuntar media sin la bóveda cargada, o sin saber quién recibió o compró ese medio (rotación y exclusión activas).
- Un filtro de gasto, actividad o compra donde nadie se puede clasificar.

Un fan concreto sin ese campo se omite y se lista. No se le trata como si gastara 0 o llevara días sin entrar.

## Fases

1. **Esta.** Modelo, compositor, segmentos, planes (precio, hora, unsend, follow-up, rotación) y dry-run. Tabla `of_mass_message`. Tests de dominio.
2. **Pantalla.** Sustituir el borrador de Campañas por este modelo, sin activar el envío.
3. **Transporte.** Reutilizar el conector que apruebe el envío 1 a 1. Este módulo no llama a la API. Unsend y follow-up solo se ejecutan con la compuerta abierta y la cuenta en la allowlist.
4. **Cifras vivas.** Vistos, compras e ingresos cuando el sync los ate a ese masivo. Hasta entonces la ficha muestra «Sin datos».

## Estadísticas

| Cifra    | Cuándo hay número                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------ |
| Enviados | Entregas con estado `enviado`. Sin registro: «Sin datos».                                              |
| Vistos   | Todas esas entregas traen `viewed`. Si falta en alguna: «Sin datos».                                   |
| Compras  | Igual con `purchased`.                                                                                 |
| Buy rate | Compras / enviados, solo si ambos son números y enviados es mayor que 0. Un chatter no lo ve.          |
| Ingresos | Suma de precios de lo comprado. Si a una compra le falta el precio: «Sin datos». Un chatter no los ve. |
| Chatter  | Nombre guardado al crear. Si no hay: «Sin datos».                                                      |
