import assert from "node:assert/strict";
import { test } from "node:test";
import { writeAccountProxy } from "../proxy.ts";
import { createSessionRuntime } from "../runtime.ts";
import { startFixture } from "./fixture-site.ts";
import { completeFixtureLogin, recordingFactory, removeDir, tempDataDir, testConfig, testDisplay } from "./helpers.ts";
import path from "node:path";

test("el perfil del simulador abre con el proxy de la cuenta y sin dejar la clave", { timeout: 60_000 }, async () => {
  const dataDir = await tempDataDir();
  const fixture = await startFixture();
  const events: string[] = [];
  const created = await createSessionRuntime({
    config: testConfig(dataDir),
    site: fixture.site,
    browserFactory: recordingFactory(events),
    displayEnv: testDisplay,
    afterLoginPageOpen: (page) => completeFixtureLogin(page),
  });
  try {
    const account = await created.sessions.addAccount("Principal");
    await created.sessions.whenLoginSettled(account.id);
    const secret = "clave-proxy-no-log";
    await writeAccountProxy(
      path.join(dataDir, "proxies", `${account.id}.bin`),
      { server: "http://127.0.0.1:9", username: "proxyuser", password: secret },
      testConfig(dataDir).sessionKey!,
    );
    await created.sessions.inspectConnection(account.id, "@creadora");
    assert.equal(events.some((event) => event === "proxy:http://127.0.0.1:9"), true);
    assert.equal(events.some((event) => event.includes(secret)), false);
    assert.equal(events.some((event) => event.includes("proxyuser")), false);
  } finally {
    await created.close();
    await fixture.close();
    await removeDir(dataDir);
  }
});
