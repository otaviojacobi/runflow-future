/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The e2e suite runs its own mock API (RUNFLOW_API) so it never touches the demo data on :8787.
const API = process.env.RUNFLOW_API || "http://localhost:8787";

/**
 * /dev/status imports docs/build-plan.md, which is outside this folder, so Vite doesn't react when it changes: watch
 * it, drop the cached module and reload the page, so the status follows the plan live (the founder checks :8080).
 */
const watchPlan = (): Plugin => ({
  name: "runflow-watch-build-plan",
  apply: "serve",
  configureServer(server) {
    const plan = fileURLToPath(new URL("../docs/build-plan.md", import.meta.url));
    server.watcher.add(plan);
    // Editors and git often replace the file instead of writing into it: that arrives as "add".
    server.watcher.on("all", (event, file) => {
      if ((event !== "change" && event !== "add") || resolve(file) !== plan) return;
      const graph = server.environments.client.moduleGraph;
      for (const m of graph.getModulesByFile(plan) ?? []) graph.invalidateModule(m);
      server.environments.client.hot.send({ type: "full-reload" });
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwind(), watchPlan()],
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
  test: { environment: "node", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
