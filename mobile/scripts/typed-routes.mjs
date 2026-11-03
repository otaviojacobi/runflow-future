// Typed routes (expo-router) without the dev server: writes .expo/types/router.d.ts from src/app, so the typecheck
// works in CI and in a fresh checkout. `expo start` keeps regenerating it while you edit.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.EXPO_ROUTER_APP_ROOT = path.join(root, "src/app");
const require = createRequire(path.join(root, "package.json"));
const { regenerateDeclarations } = require("@expo/router-server/build/typed-routes");
// A fresh checkout has no .expo/ yet: the generator writes into the folder but doesn't create it.
mkdirSync(path.join(root, ".expo/types"), { recursive: true });
regenerateDeclarations(path.join(root, ".expo/types"), {});
