# CLAUDE.md

Runflow is a training platform for Brazilian clubs (running, gyms, swimming, hybrids).
**`root.md` is the source of truth** for intent, decisions (§9) and the session plan (§10). Read it before doing anything.

## Session protocol

1. Read `root.md` §0–§4 and §9, then `docs/build-plan.md`. Then read the `CLAUDE.md` of the area you're working in (`design/`, `api/`, `frontend/`, `mobile/`, `backend/`).
2. Take the **first unchecked step** in `docs/build-plan.md` and build it. Don't build ahead; note later work in the plan instead.
3. Finish each step by:
   - running the checks (`npm run check` at the root) and getting them green;
   - ticking the step in `docs/build-plan.md` (plus `root.md` §9 and the session log if a decision changed);
   - committing **and pushing**. The founder authorized this after every step, so no need to ask.

## Hard rules

- **No AI attribution in git.** Never add `Co-Authored-By:` trailers, "Generated with Claude Code" footers, or any mention of an AI assistant in commits, PRs or code. The founder is the only author.
- **Contract first (D-020).** Screens only use endpoints listed in `api/endpoints.md` and tables in `api/schema.sql`. If a screen needs more, change the schema, catalog and mock first, in the same step.
- **Decisions are sticky.** Never contradict §9 silently. Ask the founder, then update §9 and every affected section.
- **Language (D-013).** Everything a person sees is pt-BR by default: app UI, the design system pages, mocks, emails, notifications and **error messages, including backend API errors** (pt-BR `title`/`detail` plus a stable English `code`). Internals are English: code, comments, commits, logs, `root.md`, docs. Apps use i18n keys; mocks and design pages may inline pt-BR text.
- **Tokens only.** Never hardcode colors, spacing, radii, fonts or durations. Use the `design/` tokens.
- **Areas stay splittable (§7.1).** An area never imports another area's source. Use package names and generated artifacts (OpenAPI) only.
- **Runflow is the app; clubs only theme it (D-018).** No white-label app features.
- **Keep `root.md` an index** (under ~600 lines). Move detail into `docs/<area>/` and link it.
- **Secrets live only in `.env`** (git-ignored). Never commit it, print it, or copy values from it into code, docs or logs.
- **Port 8080 always shows the current app.** Keep `npm run dev` running (mock API :8787 + web :8080) while you work; the founder checks progress there, and `/dev/status` renders `docs/build-plan.md` live. Never stop it or move it to another port.

## Layout

```
root.md     intent, decisions, roadmap: start here
.env.example  every backend setting, documented (copy to .env, git-ignored)
docker-compose.yaml  Postgres + Garage (S3) + the real API for local dev (npm run up → :3000; npm run doctor)
setup-todo.md  the founder's open setup steps (full QA guide: docs/ops/qa-pi.md); ops/qa/ holds the Pi's compose, timers and scripts
CLAUDE.md   this file
docs/       build-plan.md: every screen, in order, with status
design/     tokens, club-theme engine, foundations page   (node design/serve.mjs → :8081)
api/        contract: schema.sql, endpoints.md, mock/     (mock API → :8787)
frontend/   React · TypeScript · Vite SPA                 (web app → :8080, always running)
mobile/     Expo · React Native · TypeScript              (Phase 3)
backend/    Rust · axum · sqlx · PostgreSQL               (Phase 2, D-025)
ops/        QA on the NUC (its data is kept and schema changes are migrations, D-051); production setup comes in P1
```

Each area documents its own commands in its own `CLAUDE.md`, created in its bootstrap session.

## Commits

Conventional commits (`feat(design): …`, `docs(root): …`). Reference screen IDs from `root.md` §6.1 where relevant (e.g. `feat(design): mock M1 Hoje`). Keep commits small and leave every commit in a working state.
