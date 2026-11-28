# Empleados e invitaciones

Personal › Empleados. Solo la dueña ve la pestaña. Todo se decide en el servidor.

## Flujo

1. **Añadir empleado**: nombre, correo, rol y creadoras. Al guardar se crea una invitación (`staff_invite`) con un token de un solo uso. En la base solo está su hash (SHA-256). Caduca a los 7 días.
2. Sale un correo con `/invitacion/<token>`. Sin clave de correo no falla: el modal enseña el enlace para copiarlo y enviarlo a mano.
3. La persona abre el enlace, elige su contraseña (8 caracteres como mínimo) y queda activada. Entra con correo y contraseña en `/login`.
4. No hay registro libre: `emailAndPassword` está encendido con `disableSignUp`. La única forma de tener contraseña es aceptar una invitación. Quien entra sin invitación no tiene permisos ni creadoras.
5. **Desactivar** borra sus sesiones y el servidor deja de responderle (401), aunque la cookie en caché siga viva. **Activar** lo devuelve; tendrá que entrar otra vez.
6. **Eliminar** borra su ficha, sus permisos y su cuenta. Sus envíos se quedan: `of_chat_outbound.author_id` pasa a null (FK `ON DELETE SET NULL`) y el nombre se conserva en `author_name`, igual que en `of_chat_message`.
7. **Reenviar invitación** anula el enlace anterior y manda uno nuevo con 7 días.

Personal tiene solo dos pestañas: Creadoras y Empleados. La antigua pestaña Chatters desapareció y sus URLs (`/equipo`, `?tab=chatters`) abren Empleados. La tabla incluye también a los miembros anteriores a las invitaciones (sin correo). **Editar** tiene secciones: datos y rol, Permisos (las casillas), Creadoras asignadas y Avisos por teléfono (WhatsApp, interruptor y minutos entre avisos). Debajo de la tabla siguen Tu sesión (nombre en el chat), Métricas, Turnos e Incorporar (cuadrante de la consola). La tabla de permisos de demostración de la antigua pestaña se quitó: sus casillas eran locales y las reales están en Editar.

Los roles (Chatter, Account Manager, Team Manager, Supervisor, Analyst) solo marcan nivel. Todos entran con el permiso `mensajes` hasta que exista la matriz de permisos por rol. Owner no se puede asignar.

## Correo (Resend)

Variables de entorno. Añade este bloque al script con el que arrancas, sin valores hasta que tengas la clave:

```bash
# Correo de invitaciones (Resend). Sin RESEND_API_KEY la invitación sigue funcionando: copia el enlace del modal.
# export RESEND_API_KEY=
# export FANLINK_MAIL_FROM=      # por ejemplo: Fanlink <hola@tudominio.es>, con el dominio verificado en Resend
# export BETTER_AUTH_URL=        # origen público del enlace (en el Mac, si no se pone, se usa el de la petición)
```

## En local

Con `VITE_AUTH_ENABLED=false` quien abre sin cookie sigue siendo el usuario local (la dueña). Un empleado que acepta una invitación recibe una cookie de sesión y el servidor lo reconoce a él. El enlace de invitación lleva el origen con el que abriste la consola (`http://127.0.0.1:8080/...`), así que solo funciona en ese Mac. Prueba con Chrome: Safari no guarda cookies `Secure` en `http://`.
