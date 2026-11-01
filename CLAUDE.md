# CLAUDE.md

Runflow is a training platform for Brazilian clubs (running, gyms, swimming, hybrids).
**`root.md` is the source of truth** for intent, decisions (§9) and the session plan (§10). Read it before doing anything.

## Session protocol

1. Read `root.md` §0–§4 and §9. Then read the §10 item you're doing, the §6/§7 sections it touches, and the `CLAUDE.md` of the area you're working in (`design/`, `backend/`, `frontend/`, `mobile/`), if it exists.
2. Do **one** §10 work item. Don't build ahead. If something belongs to a later item, write it down in `root.md` instead.
3. Finish by:
   - running the area's `check` command and getting it green;
   - updating `root.md` §10 (status and session log), plus §9 if a decision changed;
   - committing.

## Hard rules

- **No AI attribution in git.** Never add `Co-Authored-By:` trailers, "Generated with Claude Code" footers, or any mention of an AI assistant in commits, PRs or code. The founder is the only author.
- **Phase 0 is design only (D-015).** Until the founder signs off on the mocks (D7), write no backend, frontend or mobile code. Remove this rule after sign-off.
- **Decisions are sticky.** Never contradict §9 silently. Ask the founder, then update §9 and every affected section.
- **Language (D-013).** Everything a person sees is pt-BR by default: app UI, the design system pages, mocks, emails, notifications and **error messages, including backend API errors** (pt-BR `title`/`detail` plus a stable English `code`). Internals are English: code, comments, commits, logs, `root.md`, docs. Apps use i18n keys; mocks and design pages may inline pt-BR text.
- **Tokens only.** Never hardcode colors, spacing, radii, fonts or durations. Use the `design/` tokens.
- **Areas stay splittable (§7.1).** An area never imports another area's source. Use package names and generated artifacts (OpenAPI) only.
- **Runflow is the app; clubs only theme it (D-018).** No white-label app features.
- **Keep `root.md` an index** (under ~600 lines). Move detail into `docs/<area>/` and link it.

## Layout

```
root.md     intent, decisions, roadmap: start here
CLAUDE.md   this file
design/     tokens, club-theme engine, showcase, mocks   (D1: node design/serve.mjs → :8080)
backend/    Rust · axum · sqlx · PostgreSQL               (from S1)
frontend/   React · TypeScript · Vite SPA                 (from S4)
mobile/     Expo · React Native · TypeScript              (from S5)
ops/        Pi deployment, backups                        (from S7)
```

Each area documents its own commands in its own `CLAUDE.md`, created in its bootstrap session.

## Commits

Conventional commits (`feat(design): …`, `docs(root): …`). Reference screen IDs from `root.md` §6.1 where relevant (e.g. `feat(design): mock M1 Hoje`). Keep commits small and leave every commit in a working state.
