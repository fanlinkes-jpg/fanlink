const STATUS_LABEL = {
  active: "Activa",
  expired: "Expirada",
  pending_login: "Pendiente de login",
};

const accountsEl = document.querySelector("#accounts");
const summaryEl = document.querySelector("#summary");
const bannerEl = document.querySelector("#banner");
const form = document.querySelector("#add-account");
const labelInput = document.querySelector("#label");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void addAccount();
});

async function addAccount() {
  hideBanner();
  const label = labelInput.value.trim();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const payload = await response.json();
    if (!response.ok) {
      showBanner(payload.error || "No se pudo añadir la cuenta");
      return;
    }
    labelInput.value = "";
    await refresh();
  } catch {
    showBanner("No se pudo contactar con Fanlink");
  } finally {
    button.disabled = false;
  }
}

async function accountAction(id, action) {
  hideBanner();
  const response = await fetch(`/api/accounts/${id}/${action}`, { method: "POST" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) showBanner(payload.error || "La petición no se pudo completar");
  await refresh();
}

async function refresh() {
  const response = await fetch("/api/accounts");
  if (!response.ok) {
    showBanner("No se pudo leer el estado de las cuentas");
    return;
  }
  const payload = await response.json();
  render(payload.accounts);
}

function render(accounts) {
  accountsEl.replaceChildren();
  const active = accounts.filter((account) => account.status === "active").length;
  summaryEl.textContent = accounts.length === 0 ? "" : `${active} de ${accounts.length} con sesión activa`;
  if (accounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Todavía no hay cuentas. Añade una para abrir la ventana de acceso.";
    accountsEl.append(empty);
    return;
  }
  for (const account of accounts) accountsEl.append(renderAccount(account));
}

function renderAccount(account) {
  const card = document.createElement("article");
  card.className = "account";
  card.dataset.accountId = account.id;

  const top = document.createElement("div");
  top.className = "account-top";
  const heading = document.createElement("h3");
  heading.textContent = account.label;
  const badge = document.createElement("span");
  badge.className = "status";
  badge.dataset.status = account.status;
  badge.textContent = STATUS_LABEL[account.status] ?? account.status;
  top.append(heading, badge);

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = describe(account);

  card.append(top, meta);
  if (account.lastError) {
    const error = document.createElement("p");
    error.className = "error-text";
    error.textContent = account.lastError;
    card.append(error);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(
    actionButton("Comprobar sesión", () => accountAction(account.id, "probe"), account.loginInProgress),
    actionButton(
      account.status === "active" ? "Rehacer login" : "Abrir login",
      () => accountAction(account.id, "login"),
      account.loginInProgress,
    ),
  );
  card.append(actions);
  return card;
}

function describe(account) {
  if (account.loginInProgress) {
    return "Ventana de Chromium abierta. Completa el acceso en OnlyFans.";
  }
  if (account.status === "pending_login") {
    return account.hasStorageState
      ? "Hay que volver a entrar. La ventana se abre para repetir el acceso."
      : "Pendiente del primer acceso. No hay sesión guardada.";
  }
  if (account.status === "expired") {
    return "La sesión guardada ya no sirve. Abre el login para rehacerla.";
  }
  const checked = account.lastCheckedAt ? `Última comprobación: ${formatTime(account.lastCheckedAt)}` : "Sesión guardada";
  return checked;
}

function formatTime(iso) {
  return `${new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso))} (Madrid)`;
}

function actionButton(text, onClick, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = text;
  button.disabled = disabled;
  button.addEventListener("click", () => {
    void onClick();
  });
  return button;
}

function showBanner(message) {
  bannerEl.hidden = false;
  bannerEl.textContent = message;
}

function hideBanner() {
  bannerEl.hidden = true;
  bannerEl.textContent = "";
}

await refresh();
setInterval(() => {
  void refresh();
}, 2000);
