import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { onlyFansSite } from "./sessions/onlyfans.js";

const config = loadConfig();
const { app, sessions, close } = await createApp({
  config,
  site: onlyFansSite,
  logger: console,
});

await sessions.startup();

const server = createServer(app);
server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : config.port;
  console.log(`Fanlink escuchando en http://${config.host}:${port}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
