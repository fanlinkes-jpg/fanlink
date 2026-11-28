import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";

// Solo para el test del scroll del chat: sirve la página de prueba con React y el alias @, sin la app.
export default defineConfig({
  root: fileURLToPath(new URL("../../../..", import.meta.url)),
  plugins: [viteReact()],
  resolve: { alias: { "@": fileURLToPath(new URL("../../../../src", import.meta.url)) } },
  server: { fs: { strict: false } },
});
