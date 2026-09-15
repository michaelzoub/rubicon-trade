import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: {
    "@": fileURLToPath(new URL(".", import.meta.url)),
    // Next.js swaps this for an empty module on the server; do the same under test.
    "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
  } },
});
