// @lovable.dev/vite-tanstack-config already includes the core plugins — do NOT add them manually.
// Never set ssr.external or resolve.external. Never add compression plugins.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    server: {
      // Basic hardening headers for the web app (no CSP here: the dev server needs inline scripts and a websocket for hot reload).
      headers: { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" },
      // Local runs: forward /api to the existing Next.js backend so cookies stay same-origin.
      // API_TARGET lets a second checkout point at a backend on another port.
      proxy: { "/api": { target: process.env["API_TARGET"] ?? "http://localhost:3000", changeOrigin: false } },
    },
  },
});
