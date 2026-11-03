/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// The e2e suite runs its own mock API (RUNFLOW_API) so it never touches the demo data on :8787.
const API = process.env.RUNFLOW_API || "http://localhost:8787";

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // @runflow/design/color and /logo are UMD/CommonJS files: pre-bundle them so ESM imports work in dev.
  optimizeDeps: { include: ["@runflow/design/color", "@runflow/design/logo"] },
  server: {
    port: Number(process.env.PORT) || 8080,
    strictPort: true,
    host: true,
    proxy: { "/api": { target: API, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  // `vite preview` serves the production build (service worker, PWA) with the same API proxy.
  preview: { port: 4173, strictPort: true, proxy: { "/api": { target: API, rewrite: (p) => p.replace(/^\/api/, "") } } },
  build: { chunkSizeWarningLimit: 400 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
