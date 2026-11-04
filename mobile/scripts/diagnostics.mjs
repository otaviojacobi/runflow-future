// Prints lib/diagnostics.ts's results from Node (the reference for /dev/hermes on a phone). Plain Node ≥ 23.6.
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({ resolve: (spec, ctx, next) => next(spec.startsWith(".") && !path.extname(spec) ? spec + ".ts" : spec, ctx) });
const { runDiagnostics } = await import(pathToFileURL(path.join(root, "src/lib/diagnostics.ts")).href);
console.log(JSON.stringify(runDiagnostics()));
