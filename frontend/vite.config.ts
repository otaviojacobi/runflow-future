/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // @runflow/design/color is a UMD/CommonJS file: pre-bundle it so ESM imports work in dev.
  optimizeDeps: { include: ["@runflow/design/color"] },
  server: {
    port: 5173,
    host: true,
    proxy: { "/api": { target: "http://localhost:8787", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  build: { chunkSizeWarningLimit: 400 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
