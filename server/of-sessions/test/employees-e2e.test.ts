import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium, type Page } from "playwright";
import { AccountStore } from "../store/account-store.ts";
import { assertDevPortFree, shotFile } from "../../../src/lib/dev-test-server.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const PASSWORD = "contraseña-segura-1";
const SECRET = "SECRETO-TERCERA";

test("la dueña invita, el empleado acepta, entra con correo y contraseña y solo ve sus creadoras; desactivar le corta el acceso", async () => {
  const dir = path.join(tmpdir(), `fanlink-empleados-${Date.now()}`);
  await seed(dir);
  const port = await freePort();
  const server = await startDev(dir, port);
  const browser = await chromium.launch();
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/mensajes`);
    const owner = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    owner.on("dialog", (dialog) => void dialog.accept());

    // 1. La dueña abre Personal > Empleados y añade a Marta con dos de tres creadoras.
    await owner.goto(`${base}/administrar?tab=empleados`, { waitUntil: "domcontentloaded" });
    await owner.getByTestId("employees-table").waitFor();
    // Solo hay dos pestañas. La antigua Chatters ya no existe y su URL abre Empleados.
    assert.equal(await owner.getByRole("button", { name: "Chatters" }).count(), 0);
    assert.equal(await owner.getByRole("button", { name: "Creadoras", exact: true }).count(), 1);
    // Los miembros antiguos sin invitación salen en la tabla.
    const oldRow = owner.getByTestId("employee-row").filter({ hasText: "Antiguo" });
    await oldRow.waitFor();
    assert.match(await oldRow.innerText(), /Nora/);
    assert.match(await oldRow.innerText(), /Activado/);
    await owner.goto(`${base}/administrar?tab=chatters`, { waitUntil: "domcontentloaded" });
    await owner.getByTestId("employees-table").waitFor();
    await owner.goto(`${base}/equipo`, { waitUntil: "domcontentloaded" });
    await owner.getByTestId("employees-table").waitFor();
    assert.match(owner.url(), /tab=empleados/);
    // Título del grupo y filtros del estilo Infloww.
    await owner.getByRole("heading", { name: "FANLINK MANAGEMENT" }).waitFor();
    for (const label of ["Por empleado", "Por creador", "Por estado"]) await owner.getByLabel(label, { exact: true }).waitFor();
    await owner.getByRole("button", { name: "Reestablecer" }).waitFor();
    await owner.getByRole("button", { name: "Buscar" }).waitFor();
    const ownerRow = owner.getByTestId("employee-row").filter({ hasText: "Dueña" });
    assert.equal(await ownerRow.getAttribute("data-owner"), "true");
    assert.equal(await ownerRow.getByRole("button", { name: /Editar/ }).count(), 0, "la fila del owner no se edita");
    assert.equal(await ownerRow.getByRole("checkbox").isDisabled(), true);
    await owner.getByRole("button", { name: "Añadir empleado" }).click();
    const dialog = owner.getByRole("dialog", { name: "Añadir empleado" });
    await dialog.getByLabel("Nombre de empleado").fill("Marta Ruiz");
    await dialog.getByLabel("Correo electrónico").fill("marta@example.com");
    await dialog.getByLabel("Grupo").waitFor();
    assert.equal(await dialog.getByLabel("Añadir rol").locator("option", { hasText: "Owner" }).count(), 0, "Owner no se puede asignar");
    assert.equal(await dialog.getByLabel("Añadir rol").locator("option", { hasText: "Admin" }).count(), 1);
    await dialog.getByLabel("Asignar creador(es)").selectOption("c-alba");
    await dialog.getByLabel("Asignar creador(es)").selectOption("c-nora");
    await dialog.getByTestId("creator-chips").getByText("Alba - alba").waitFor();
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    // Al dar de alta sale el pop-up con los permisos del rol premarcados; el chatter no puede tener dinero.
    const altaPerms = owner.getByRole("dialog", { name: "Permisos del rol" });
    await altaPerms.waitFor();
    assert.equal(await altaPerms.locator('input[data-perm="mensajes"]').isChecked(), true);
    assert.equal(await altaPerms.locator('input[data-perm="precios"]').isChecked(), false);
    assert.equal(await altaPerms.locator('input[data-perm="banco"]').isDisabled(), true);
    for (const group of ["Workspace", "Team Mgmt", "Analytics", "Chat", "Account Settings", "Statements"]) await altaPerms.getByRole("group", { name: group }).waitFor();
    await altaPerms.getByRole("button", { name: "Confirmar y añadir" }).click();
    // Sin RESEND_API_KEY no falla: enseña el enlace para copiarlo.
    const delivery = owner.getByTestId("invite-delivery");
    await delivery.waitFor();
    assert.match(await delivery.innerText(), /no está configurado/);
    const link = await owner.getByTestId("invite-link").inputValue();
    assert.match(link, new RegExp(`^http://127\\.0\\.0\\.1:${port}/invitacion/[A-Za-z0-9_-]{40,}$`));
    await owner.getByRole("button", { name: "Listo" }).click();
    const row = owner.getByTestId("employee-row").filter({ hasText: "Marta Ruiz" });
    await row.waitFor();
    assert.match(await row.innerText(), /Invitado/);
    assert.match(await row.innerText(), /Alba/);
    assert.match(await row.innerText(), /Chatter/);
    assert.match(await row.innerText(), /Alba, Nora/);
    assert.equal(await owner.getByTestId("employee-row").filter({ hasText: "Tercera" }).count(), 0);

    // Entrar sin invitación no da acceso: un enlace inventado no abre nada.
    const stranger = await (await browser.newContext()).newPage();
    await stranger.goto(`${base}/invitacion/token-inventado`, { waitUntil: "domcontentloaded" });
    await stranger.getByText("Este enlace de invitación no es válido.").waitFor();
    assert.equal(await stranger.getByRole("button", { name: /Aceptar invitación/ }).count(), 0);
    // El registro libre está cerrado aunque el origen sea de confianza.
    const signUp = await stranger.context().request.post(`${base}/api/auth/sign-up/email`, {
      headers: { origin: "http://127.0.0.1:8080" },
      data: { email: "intruso@example.com", password: "12345678abc", name: "Intruso" },
    });
    assert.equal(signUp.status(), 400, await signUp.text());
    assert.match(await signUp.text(), /sign up/i);
    await stranger.close();

    // 2. El empleado acepta, pone la contraseña y entra.
    const employeeContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const employee = await employeeContext.newPage();
    await employee.goto(link, { waitUntil: "domcontentloaded" });
    await employee.getByText("Hola, Marta Ruiz").waitFor();
    await employee.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await employee.getByLabel("Repite la contraseña").fill("otra-distinta-1");
    await employee.getByRole("button", { name: /Aceptar invitación/ }).click();
    await employee.getByText(/no coinciden/).waitFor();
    await employee.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await employee.getByLabel("Repite la contraseña").fill(PASSWORD);
    await employee.getByRole("button", { name: /Aceptar invitación/ }).click();
    await employee.waitForURL(`${base}/`, { timeout: 30_000 });

    await employee.goto(`${base}/mensajes`, { waitUntil: "domcontentloaded" });
    const column = employee.getByRole("complementary", { name: "Creadoras" });
    await column.getByRole("button", { name: /Alba/ }).waitFor({ timeout: 30_000 });
    await column.getByRole("button", { name: /Nora/ }).waitFor();
    assert.equal(await column.getByRole("button", { name: /Tercera/ }).count(), 0);
    assert.equal(await employee.getByRole("link", { name: "Personal" }).count(), 0);
    await employee.goto(`${base}/administrar`, { waitUntil: "domcontentloaded" });
    await employee.getByText("no tiene acceso a esta sección.").waitFor({ timeout: 15_000 });
    const status = (page: Page, url: string, body: unknown) =>
      page.evaluate(async ([target, payload]) => (await fetch(target as string, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })).status, [url, body] as const);
    assert.equal(await status(employee, `${base}/api/vault-query`, { creatorId: "c-tercera" }), 403);
    await employee.screenshot({ path: shotFile("empleado-mensajes.png") });

    // 3. El enlace ya no vale una segunda vez.
    const again = await (await browser.newContext()).newPage();
    await again.goto(link, { waitUntil: "domcontentloaded" });
    await again.getByText("Esta invitación ya se usó.").waitFor();
    await again.close();

    // 4. La dueña lo ve como Activado.
    await owner.reload({ waitUntil: "domcontentloaded" });
    const activeRow = owner.getByTestId("employee-row").filter({ hasText: "Marta Ruiz" });
    await activeRow.waitFor();
    assert.match(await activeRow.innerText(), /Activado/);
    // El buscador es instantáneo: filtra al escribir o elegir, sin pulsar Buscar. Reestablecer limpia.
    const filter = async (who: string, creator: string, status: string) => {
      await owner.getByLabel("Por empleado", { exact: true }).fill(who);
      await owner.getByLabel("Por creador", { exact: true }).selectOption(creator);
      await owner.getByLabel("Por estado", { exact: true }).selectOption(status);
    };
    await filter("", "todas", "invited");
    await activeRow.waitFor({ state: "detached" });
    await filter("", "todas", "active");
    await activeRow.waitFor();
    await filter("", "c-nora", "active");
    await activeRow.waitFor();
    await filter("", "c-tercera", "active");
    await activeRow.waitFor({ state: "detached" });
    await filter("mar", "todas", "todos");
    await activeRow.waitFor();
    assert.equal(await owner.getByTestId("employee-row").count(), 1);
    await owner.getByRole("button", { name: "Reestablecer" }).click();
    assert.equal(await owner.getByLabel("Por empleado", { exact: true }).inputValue(), "");
    await oldRow.waitFor();
    // Última conexión: la dueña acaba de entrar; Marta entró al aceptar; una invitación no tiene.
    assert.match(await ownerRow.getByTestId("employee-last-seen").innerText(), /Ahora|hace \d+ min/);
    assert.match(await activeRow.getByTestId("employee-last-seen").innerText(), /Ahora|hace \d+ min/);
    assert.equal(await oldRow.getByTestId("employee-last-seen").innerText(), "Nunca");
    await owner.getByTestId("employees-card").screenshot({ path: shotFile("personal-tabla-empleados.png") });

    // Turnos queda debajo de la tabla con el mismo ancho, título y estilo de tabla.
    const table = await owner.getByTestId("employees-card").boundingBox();
    const turnos = owner.getByTestId("turnos-card");
    await turnos.getByRole("heading", { name: "Turnos" }).waitFor();
    const shifts = await turnos.boundingBox();
    assert.ok(table && shifts);
    assert.equal(Math.round(shifts.x), Math.round(table.x));
    assert.equal(Math.round(shifts.width), Math.round(table.width));
    assert.ok(shifts.y > table.y + table.height, "Turnos va debajo de la tabla de empleados");
    // Las personas reales de la tabla salen en Turnos con su rol y en Métricas.
    await turnos.getByText("Marta Ruiz").waitFor();
    await turnos.getByText("Antiguo").waitFor();
    await owner.getByTestId("métricas-card").getByText("Marta Ruiz").waitFor();
    assert.equal(await turnos.locator("thead").getAttribute("class"), await owner.getByTestId("employees-table").locator("thead").getAttribute("class"));

    // Horarios: clic en la celda abre el editor (entrada, salida, Libre, copiar). Se guarda en la base.
    const martaShifts = turnos.locator("tr", { hasText: "Marta Ruiz" });
    await martaShifts.getByRole("button").first().click();
    const editor = owner.getByRole("dialog", { name: "Editar horario" });
    await editor.waitFor();
    await editor.getByRole("radio", { name: "Con horario" }).check();
    await editor.getByLabel("Hora de entrada", { exact: true }).fill("08:00");
    await editor.getByLabel("Hora de salida", { exact: true }).fill("16:00");
    await editor.getByLabel("Copiar horario").selectOption("weekdays");
    await owner.screenshot({ path: shotFile("turno-editor.png") });
    await editor.getByRole("button", { name: "Guardar" }).click();
    await editor.waitFor({ state: "detached" });
    await martaShifts.getByRole("button", { name: /08:00 – 16:00/ }).first().waitFor();
    await martaShifts.getByRole("button").nth(5).click();
    const night = owner.getByRole("dialog", { name: "Editar horario" });
    await night.getByRole("radio", { name: "Con horario" }).check();
    await night.getByLabel("Hora de entrada", { exact: true }).fill("22:00");
    await night.getByLabel("Hora de salida", { exact: true }).fill("06:00");
    await night.getByText(/pasa de medianoche/).waitFor();
    await night.getByRole("button", { name: "Guardar" }).click();
    await night.waitFor({ state: "detached" });
    await martaShifts.getByRole("button", { name: /22:00 – 06:00/ }).waitFor();
    assert.match(await martaShifts.getByRole("button").nth(6).innerText(), /Libre/);
    await owner.screenshot({ path: shotFile("personal-turnos.png"), fullPage: true });

    // 4b. Editar: campos obligatorios, roles en chips, creadoras en chips, permisos en pop-up y avisos por teléfono.
    await activeRow.getByRole("button", { name: "Editar Marta Ruiz" }).click();
    const edit = owner.getByRole("dialog", { name: "Editar empleado" });
    for (const section of ["Asignar creador(es)", "Permisos", "Avisos por teléfono"]) await edit.getByRole("heading", { name: section }).waitFor();
    for (const label of ["Nombre de empleado*", "Correo electrónico*", "Grupo*", "Rol*"]) await edit.getByText(label, { exact: true }).waitFor();
    await owner.screenshot({ path: shotFile("empleado-editar.png") });
    await edit.getByTestId("role-chips").getByText("Chatter").waitFor();
    await edit.getByTestId("creator-chips").getByText("Alba - alba").waitFor();
    assert.equal(await edit.getByTestId("creator-chips").getByText("Tercera - tercera").count(), 0);
    assert.match(await edit.getByTestId("perms-summary").innerText(), /^1 permiso activos/);
    // Cambiar el rol abre el pop-up con el preset de los dos roles sumados (Chatter + Team Manager).
    await edit.getByLabel("Añadir rol").selectOption("team_manager");
    const popup = owner.getByRole("dialog", { name: "Permisos del rol" });
    await popup.waitFor();
    assert.match(await popup.getByTestId("perms-roles").innerText(), /Chatter \+ Team Manager/);
    for (const perm of ["mensajes", "precios", "vault", "campanas", "equipo", "analitica"]) assert.equal(await popup.locator(`input[data-perm="${perm}"]`).isChecked(), true, perm);
    for (const perm of ["banco", "estados", "estadisticas", "todas", "ajustes"]) assert.equal(await popup.locator(`input[data-perm="${perm}"]`).isChecked(), false, perm);
    assert.match(await popup.getByTestId("perms-summary-text").innerText(), /No podrá:.*abrir el Banco/);
    assert.match(await popup.getByTestId("perms-summary-text").innerText(), /totales ni dinero de la agencia|dinero de la agencia/);
    assert.equal(await popup.locator('input[data-perm="banco"]').isDisabled(), true);
    assert.equal(await popup.locator('input[data-perm="banco"]').isChecked(), false);
    await owner.screenshot({ path: shotFile("permisos-popup.png") });
    await popup.getByRole("button", { name: "Aplicar permisos" }).click();
    await edit.getByTestId("role-chips").getByText("Team Manager").waitFor();
    assert.match(await edit.getByTestId("perms-summary").innerText(), /^6 permisos activos/);
    await edit.getByLabel("Asignar creador(es)").selectOption("c-tercera");
    await edit.getByLabel("WhatsApp").fill("600");
    await edit.getByRole("button", { name: "Guardar", exact: true }).click();
    await edit.getByRole("alert").getByText(/formato internacional/).waitFor();
    await edit.getByLabel("WhatsApp").fill("+34600111222");
    await edit.getByRole("checkbox", { name: "Avisos", exact: true }).check();
    await edit.getByLabel("Minutos entre avisos del mismo fan").fill("20");
    await edit.getByRole("button", { name: "Quitar Tercera - tercera" }).click();
    await edit.getByRole("button", { name: "Guardar", exact: true }).click();
    await edit.waitFor({ state: "detached" });
    await activeRow.getByTestId("employee-roles").getByText("Chatter, Team Manager").waitFor();
    await activeRow.getByRole("button", { name: "Editar Marta Ruiz" }).click();
    const again2 = owner.getByRole("dialog", { name: "Editar empleado" });
    await again2.getByRole("heading", { name: "Permisos" }).waitFor();
    assert.match(await again2.getByTestId("perms-summary").innerText(), /^6 permisos activos/);
    await again2.getByRole("button", { name: "Ver y editar permisos" }).click();
    const saved = owner.getByRole("dialog", { name: "Permisos del rol" });
    assert.equal(await saved.locator('input[data-perm="banco"]').isChecked(), false);
    assert.equal(await saved.locator('input[data-perm="banco"]').isDisabled(), true);
    assert.equal(await saved.locator('input[data-perm="estados"]').isChecked(), false);
    assert.match(await saved.getByTestId("perms-summary-text").innerText(), /No podrá:.*abrir el Banco/);
    await saved.getByRole("button", { name: "Cancelar" }).click();
    assert.equal(await again2.getByTestId("creator-chips").getByText("Tercera - tercera").count(), 0);
    assert.equal(await again2.getByLabel("WhatsApp").inputValue(), "+34600111222");
    assert.equal(await again2.getByRole("checkbox", { name: "Avisos", exact: true }).isChecked(), true);
    assert.equal(await again2.getByLabel("Minutos entre avisos del mismo fan").inputValue(), "20");
    await again2.getByRole("button", { name: "Cancelar", exact: true }).click();
    // Un miembro antiguo conserva lo que ya tenía y lo ve en Editar.
    await oldRow.getByRole("button", { name: "Editar Antiguo" }).click();
    const oldEdit = owner.getByRole("dialog", { name: "Editar empleado" });
    await oldEdit.getByRole("heading", { name: "Avisos por teléfono" }).waitFor();
    await oldEdit.getByTestId("creator-chips").getByText("Nora - nora").waitFor();
    assert.equal(await oldEdit.getByLabel("WhatsApp").inputValue(), "+34600000000");
    assert.equal(await oldEdit.getByLabel("Minutos entre avisos del mismo fan").inputValue(), "30");
    await oldEdit.getByRole("button", { name: "Ver y editar permisos" }).click();
    const oldPerms = owner.getByRole("dialog", { name: "Permisos del rol" });
    assert.equal(await oldPerms.locator('input[data-perm="vault"]').isChecked(), true);
    assert.equal(await oldPerms.locator('input[data-perm="precios"]').isChecked(), false);
    await oldPerms.getByRole("button", { name: "Cancelar" }).click();
    await oldEdit.getByRole("button", { name: "Cancelar", exact: true }).click();

    // 5. Login con correo y contraseña desde cero; con la contraseña mala no entra.
    const login = await (await browser.newContext()).newPage();
    await login.goto(`${base}/login`, { waitUntil: "networkidle" });
    await login.getByLabel("Correo").fill("marta@example.com");
    await login.getByLabel("Contraseña").fill("incorrecta-123");
    await login.getByRole("button", { name: "Entrar", exact: true }).click();
    await login.getByText("Correo o contraseña incorrectos.").waitFor();
    await login.getByLabel("Contraseña").fill(PASSWORD);
    await login.getByRole("button", { name: "Entrar", exact: true }).click();
    await login.waitForURL(`${base}/`, { timeout: 30_000 });
    await login.goto(`${base}/mensajes`, { waitUntil: "domcontentloaded" });
    await login.getByRole("complementary", { name: "Creadoras" }).getByRole("button", { name: /Alba/ }).waitFor({ timeout: 30_000 });
    await login.close();

    // 6. Desactivar corta la sesión al momento.
    assert.notEqual(await status(employee, `${base}/api/vault-query`, { creatorId: "c-alba" }), 401);
    await activeRow.getByRole("button", { name: "Más acciones de Marta Ruiz" }).click();
    await owner.getByRole("menuitem", { name: "Desactivar" }).click();
    await owner.getByTestId("employee-row").filter({ hasText: "Marta Ruiz" }).getByText("Desactivado").waitFor();
    assert.equal(await status(employee, `${base}/api/vault-query`, { creatorId: "c-alba" }), 401);
    const blocked = await (await browser.newContext()).request.post(`${base}/api/staff-login`, { data: { email: "marta@example.com", password: PASSWORD } });
    assert.equal(blocked.status(), 403);

    // 7. Activar la devuelve; eliminar la quita y sus envíos se quedan con el nombre.
    await activeRow.getByRole("button", { name: "Más acciones de Marta Ruiz" }).click();
    await owner.getByRole("menuitem", { name: "Activar" }).click();
    await owner.getByTestId("employee-row").filter({ hasText: "Marta Ruiz" }).getByText("Activado", { exact: true }).waitFor();
    assert.notEqual(await status(employee, `${base}/api/vault-query`, { creatorId: "c-alba" }), 401);

    // 8. Restablecer contraseña: enlace de un solo uso; cierra sus sesiones y la contraseña vieja deja de valer.
    await activeRow.getByRole("button", { name: "Más acciones de Marta Ruiz" }).click();
    await owner.getByRole("menuitem", { name: "Restablecer contraseña" }).click();
    const resetDialog = owner.getByRole("dialog", { name: "Restablecer contraseña" });
    await resetDialog.getByTestId("invite-delivery").waitFor();
    assert.match(await resetDialog.getByTestId("invite-delivery").innerText(), /no está configurado/);
    const resetLink = await resetDialog.getByTestId("invite-link").inputValue();
    assert.match(resetLink, new RegExp(`^http://127\\.0\\.0\\.1:${port}/restablecer/[A-Za-z0-9_-]{40,}$`));
    await resetDialog.getByRole("button", { name: "Listo" }).click();
    const resetPage = await (await browser.newContext()).newPage();
    await resetPage.goto(resetLink, { waitUntil: "networkidle" });
    await resetPage.getByText("Nueva contraseña").waitFor();
    await resetPage.getByLabel("Contraseña", { exact: true }).fill("nueva-contraseña-2");
    await resetPage.getByLabel("Repite la contraseña").fill("nueva-contraseña-2");
    await resetPage.getByRole("button", { name: "Cambiar contraseña" }).click();
    await resetPage.getByText("Contraseña cambiada").waitFor();
    const reused = await (await browser.newContext()).newPage();
    await reused.goto(resetLink, { waitUntil: "domcontentloaded" });
    await reused.getByText("Este enlace ya se usó.").waitFor();
    assert.equal(await status(employee, `${base}/api/vault-query`, { creatorId: "c-alba" }), 401);
    const oldPassword = await (await browser.newContext()).request.post(`${base}/api/staff-login`, { data: { email: "marta@example.com", password: PASSWORD } });
    assert.equal(oldPassword.status(), 401);
    const newPassword = await (await browser.newContext()).request.post(`${base}/api/staff-login`, { data: { email: "marta@example.com", password: "nueva-contraseña-2" } });
    assert.equal(newPassword.status(), 200);

    // 9. Acciones en grupo: roles en grupo y borrar en grupo.
    await oldRow.getByRole("checkbox").check();
    await owner.getByRole("button", { name: "Acciones en grupo" }).click();
    assert.equal(await owner.getByRole("menuitem", { name: "Editar grupo en grupo" }).isDisabled(), true);
    await owner.getByRole("menuitem", { name: "Editar roles en grupo" }).click();
    const bulk = owner.getByRole("dialog", { name: "Editar roles en grupo" });
    await bulk.getByLabel("Añadir rol").selectOption("analyst");
    await bulk.getByRole("button", { name: "Quitar rol Chatter" }).click();
    await bulk.getByRole("button", { name: "Guardar" }).click();
    await bulk.waitFor({ state: "detached" });
    await owner.getByTestId("employee-row").filter({ hasText: "Antiguo" }).getByTestId("employee-roles").getByText("Analyst").waitFor();
    await oldRow.getByRole("checkbox").check();
    await owner.getByRole("button", { name: "Acciones en grupo" }).click();
    await owner.getByRole("menuitem", { name: "Eliminar en grupo" }).click();
    await oldRow.waitFor({ state: "detached" });
    await activeRow.getByRole("button", { name: "Más acciones de Marta Ruiz" }).click();
    await owner.getByRole("menuitem", { name: "Borrar" }).click();
    await activeRow.waitFor({ state: "detached" });
    await employee.close();
    await owner.close();
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
    await rm(dir, { recursive: true, force: true });
  }
});

async function seed(dir: string): Promise<void> {
  const pgDir = path.join(dir, "pglite");
  await mkdir(pgDir, { recursive: true });
  const pg = new PGlite(pgDir);
  await pg.waitReady;
  await pg.exec("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  const folder = path.join(root, "migrations");
  const files = (await readdir(folder)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    await pg.exec(await readFile(path.join(folder, name), "utf8"));
    await pg.query("insert into _migrations (name) values ($1) on conflict do nothing", [name]);
  }
  const creators = [["c-alba", "Alba"], ["c-nora", "Nora"], ["c-tercera", "Tercera"]].map(([id, name], index) => ({
    id,
    name,
    handle: `@${name?.toLowerCase()}`,
    platform: "onlyfans",
    city: "España",
    subscribers: 10,
    revenue30: 987654,
    growth: 0,
    split: 25,
    status: "activa",
    hue: index * 40,
    proxy: "",
    staff: [],
  }));
  await pg.query(
    "insert into workspace_state (id, state, version, updated_by) values (1, $1::jsonb, 1, 'dueña')",
    [JSON.stringify({
      agency: "Fanlink Management",
      creators,
      fans: ["c-alba", "c-nora", "c-tercera"].map((creatorId) => ({ id: `f-${creatorId}`, creatorId, name: `Fan ${creatorId}`, handle: "fan", spendLife: 0, spend30: 0, days: 1, status: "activo", tier: "bronce", online: false, notes: creatorId === "c-tercera" ? SECRET : "", tags: [], city: "", unread: 0 })),
      messages: [],
      vault: [],
      scripts: [],
      lists: [],
      campaigns: [],
      employees: [],
      links: [],
      automations: [],
      history: [{ day: "2026-11-01", euros: 987654, label: "HISTORICO-AGENCIA" }],
      stopWords: [],
      copilot: true,
      translate: true,
      adaptPrices: true,
      notifyShifts: true,
    })],
  );
  // Quien abre sin cookie es el usuario local de siempre: la dueña.
  await pg.exec(`insert into workspace_member (user_id) values ('dev-user') on conflict do nothing`);
  await pg.exec(`insert into staff_profile (user_id, display_name, role, perms, level) values ('dev-user', 'Dueña', 'owner', '["mensajes","precios","vault","campanas","analitica","equipo","ajustes"]'::jsonb, 'owner')`);
  // Un miembro de antes de las invitaciones: sin correo, con permisos, una creadora y avisos.
  await pg.exec(`insert into workspace_member (user_id) values ('viejo') on conflict do nothing`);
  await pg.exec(`insert into staff_profile (user_id, display_name, role, perms) values ('viejo', 'Antiguo', 'member', '["mensajes","vault"]'::jsonb)`);
  await pg.exec(`insert into creator_grant (user_id, creator_id) values ('viejo', 'c-nora')`);
  await pg.exec(`insert into staff_alert (user_id, phone, alerts_enabled, quiet_minutes) values ('viejo', '+34600000000', true, 30)`);
  for (const [creatorId, unread] of [["c-alba", 3], ["c-nora", 2], ["c-tercera", 40]] as const) {
    await pg.query(
      `insert into of_chat_thread (creator_id, thread_key, fan_key, fan_name, last_message_at, excerpt, unread, synced_at, origin)
       values ($1, '1', '1', $2, now(), $3, $4, now(), 'onlyfans')`,
      [creatorId, `Fan ${creatorId}`, creatorId === "c-tercera" ? SECRET : "hola", unread],
    );
    await pg.query(
      `insert into of_chat_message (creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, synced_at, origin)
       values ($1, 'm1', '1', '1', true, $2, now(), now(), 'onlyfans')`,
      [creatorId, creatorId === "c-tercera" ? SECRET : "hola"],
    );
  }
  await pg.close();
  const store = new AccountStore(path.join(dir, "accounts.json"));
  await store.init();
  await store.create("Alba", "c-alba");
  await store.create("Nora", "c-nora");
  await store.create("Tercera", "c-tercera");
}

async function startDev(dir: string, port: number): Promise<ChildProcess> {
  await assertDevPortFree();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_AUTH_ENABLED: "false",
    FANLINK_DATA_DIR: dir,
    FANLINK_PGLITE_DIR: path.join(dir, "pglite"),
    FANLINK_SYNC_ENABLED: "false",
    FANLINK_HISTORY_ENABLED: "false",
  };
  delete env.DATABASE_URL;
  // Sin proveedor de correo: el modal tiene que enseñar el enlace.
  delete env.RESEND_API_KEY;
  delete env.FANLINK_MAIL_FROM;
  delete env.BETTER_AUTH_URL;
  return spawn(process.execPath, ["node_modules/vite/bin/vite.js", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    env,
    stdio: "ignore",
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const chosen = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(chosen));
    });
  });
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last = "sin respuesta";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
      last = String(response.status);
    } catch (err) {
      last = err instanceof Error ? err.message : "error";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`el servidor no arrancó: ${last}`);
}
