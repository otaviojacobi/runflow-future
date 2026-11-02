# frontend/: CLAUDE.md

The Runflow web app: React 19 + TypeScript + Vite 8 SPA, TanStack Router (code-based) + TanStack Query, Tailwind v4 bound to `@runflow/design` tokens.
Read `../root.md` (§4, §6, §7.4, §7.8) and `../docs/build-plan.md` first. Future standalone repo: `runflow-frontend`.

## Commands

| From the repo root | What |
|---|---|
| `npm run dev` | Mock API (:8787) + web (:8080, keep it running: the founder previews there; `/dev/status` = plan progress). The web proxies `/api/*` → mock. |
| `npm run check -w @runflow/frontend` | typecheck + unit tests + production build + initial-JS budget (≤ 200 KB gzip; must be green before committing) |
| `npm run e2e` | Playwright suite (`frontend/e2e`): flows, axe accessibility (WCAG AA serious/critical fail), no sideways scroll at 360 px. Starts its own mock (:8788, fresh seed) and web (:8089), so the demo on :8080 is untouched. Locally: `PW_CHROME=/usr/bin/google-chrome npm run e2e`. CI runs it on every push |
| `npm run check` | Everything: design + API contract + frontend |

## Layout

```
src/
  main.tsx, router.tsx, queryClient.ts, styles.css (Tailwind ↔ tokens), i18n.ts
  lib/        api client (ApiError), session, theme, storage, format (pt-BR)
  api/        types.ts (mirror of the contract) + one file of query/mutation hooks per domain
  ui/         generic components (Button, Input, Dialog…): no domain knowledge
  components/ domain components (WorkoutCard, IntensityProfile, SportChip…)
  domain/     pure logic (workout structure, quick-text parser, estimates): unit-tested
  screens/    one folder per area; one file per screen (screen IDs in comments)
```

## Rules

- **Text**: every visible string goes through `t("texto em pt-BR")` / `tn(n, one, other)`. The pt-BR text is the key. Never hardcode visible text without `t()`.
- **Styling**: Tailwind utilities from the token mapping only (see the header of `src/styles.css`): `bg-surface`, `text-fg-muted`, `border-line`, `bg-brand text-on-brand`, `bg-run-soft text-on-run-soft`, `bg-z4`… Text styles: `rf-text-*` classes. No hex, no default Tailwind palette (it is removed).
- **Club theme**: `brand` = the club's primary color, `accent` = its secondary. Never use them for data meaning (status, zones, sports have their own tokens).
- **Data**: screens use hooks from `src/api/*`; only endpoints from `api/endpoints.md`. Errors are `ApiError` with pt-BR `title`/`detail`: show them as they are.
- **Formats**: always `lib/format.ts` (pace `4:30`, `10,4 km`, `ter, 3 nov`, 24 h).
- **Accessibility**: real buttons and links, labels on inputs, visible focus, 44 px touch targets on mobile layouts. Accessible names must contain the visible text (prefer `sr-only` spans over `aria-label`), and anything `sr-only` needs a `relative` ancestor inside scroll areas. `npm run e2e` runs axe on the main screens.
- **Performance**: route-level code splitting for heavy screens (builder, planning); keep the initial JS under 200 KB gzip (§7.7).
