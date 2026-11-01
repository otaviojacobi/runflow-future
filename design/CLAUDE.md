# design/: CLAUDE.md

The Runflow design area: tokens, the club-theme color engine, fonts, the foundations showcase and (from D3) the mocks.
Read `../root.md` first, especially §6 (design direction, screen inventory) and §4.4 (club theming). Future standalone repo: `runflow-design`.

## Commands (run from `design/`)

| Command | What it does |
|---|---|
| `node build.mjs` | Regenerates `dist/` from `tokens.json` + `src/color.js` |
| `node build.mjs --check` | **The `check` command.** Fails if `dist/` is stale or any contrast guarantee breaks. CI runs it. |
| `node serve.mjs` | Dev server on http://localhost:8080 (`PORT=…` to change). `/` opens the showcase. |

Zero dependencies: Node ≥ 20 only. No `npm install`.

## Layout

```
tokens.json          SOURCE OF TRUTH (DTCG-style: $type/$value/{alias})
src/color.js         color engine: OKLCH scales, roles with contrast guarantees, brandCss(), logo color suggestions
build.mjs            tokens.json + color.js → dist/
dist/                GENERATED, committed on purpose (diffs show real values)
  tokens.css         CSS variables (--rf-*), light/dark, text-style classes
  tokens.ts / .json  same data for TS apps and other languages
  tokens.js          classic-script global (window.RunflowTokens) for showcase/mocks
  color-fixtures.json  golden outputs every port of color.js must reproduce (backend Rust port, mobile)
assets/fonts/        self-hosted Archivo + Inter (latin subset, OFL)
showcase/            DS1 foundations page (index.html + showcase.css + showcase.js)
mocks/               (D3+) screen mocks
```

## Rules

- **Edit `tokens.json` or `src/color.js`, never `dist/`.** Run `node build.mjs` and commit `dist/` in the same commit.
- **Everything visible is pt-BR** (labels, samples, aria-labels, alerts). Code, comments and this file are English.
- **Pages use tokens only:** `var(--rf-*)` and `.rf-text-*` classes. No raw hex in CSS. The only exception is the Runflow logo mark, which reads `RunflowTokens.seeds`.
- **Pages must work from disk and from `serve.mjs`.** Classic `<script>` tags only, no ES modules, no CDN, no build step.
- **Changing `color.js` changes every club's theme.** Review the `color-fixtures.json` diff on purpose. The backend's Rust port must be updated to match the new fixtures.
- Modes: `data-theme="light|dark"` on `<html>` or on any element forces a mode; otherwise the OS preference wins.
- Token names are part of the public contract (`@runflow/design`). Renaming or removing one is a breaking change: note it in `../root.md` §10's session log.
