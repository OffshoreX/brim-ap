import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node", exclude: ["**/node_modules/**", "web/**", ".next/**"] },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
