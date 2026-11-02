# Build plan: every screen, in order

**How to resume (any session):** read `root.md` §0–§4, then this file. Take the **first unchecked step**, build it, tick its box here, run the checks, then commit and push (founder-authorized). One step is one commit, or a few small ones.
Contract: `api/schema.sql` (DB) · `api/endpoints.md` (API) · `api/mock/` (runnable mock). If a screen needs data that isn't in the contract, **change the contract first** (schema + endpoints + mock) in the same step.
**Ambition:** build each screen with everything in its feature map below, not a stripped-down v1. Phase 1 is the full product on the mock API.

Run everything: `npm install` at the repo root, then `npm run dev`. That starts the mock API on :8787 and the web app on **:8080**, which must always stay running: the founder follows progress there. `/dev/status` shows this plan live; `/` (landing) has one-click demo logins.

## Phase 1: web app on the mock API (`frontend/`)

| Step | Scope | Screens | Status |
|---|---|---|---|
| F0 | Scaffold: npm workspaces, Vite + React + TS, Tailwind v4 bound to `@runflow/design` tokens, TanStack Router + Query, i18n (pt-BR source strings), API client + problem+json errors, mock API core (auth, `/me`), `check` script | — | [x] |
| F1 | UI kit `src/ui/*` + domain components `src/components/*`, plus a `/dev/components` page (replaces the DS2/DS3 HTML pages) | DS2, DS3 | [x] |
| F2 | Sign-in (Google mock chooser + email code), session, route guards, "no club yet" | A2, A7 | [x] |
| F3 | App shell per role (sidebar on desktop, bottom tabs on phones), club context, club theme without a flash (§7.8), club switcher | A6 | [x] |
| F4 | Owner onboarding wizard: create club → Studio quick step (0–2 colors, logo, live preview) → invite (link, WhatsApp, QR) → starter library → done | A5 | [x] |
| F5 | Invite page (club-themed) + student onboarding: consent → profile and goal → connect Strava (mock) | A3, A4 | [x] |
| F6 | Members and invites (owner); students list + groups (trainer) | O2, W2 | [x] |
| F7 | Workout builder: structured editor + quick text (`10' aquec + 6x1km @4:30 c/ 2' trote`) + intensity preview; run, swim and strength blocks | W5 | [x] |
| F8 | Library (templates by sport, search, duplicate, archive) | W6 | [x] |
| F19 | Public landing: hero with live quick-text demo, modalities, features, Club Studio demo, pricing, comparison, FAQ, demo logins; English routes | A1 | [x] |
| F9 | Planning: students × week grid, assign (library or build now; students, groups, many days), drag to move, workout detail, edit, remove, copy week | W4 | [x] |
| F10 | Student: Today, workout detail with personal targets, feedback sheet, schedule (week/month) | M1, M2, M5, M3 | [x] |
| F13 | Trainer dashboard: today's board, alerts, feedback to answer, compliance trend, onboarding checklist, plan usage | W1 | [x] |
| F11 | Activities (list, detail with laps and match to plan, manual log) + student detail for trainers (calendar, metrics, zones, profile, notes) | M4, W3 | [x] |
| F12 | Feedback inbox + comment threads (unread, flags, quick replies) | W8 | [x] |
| F14 | Planilhas: multi-week editor + apply to students/groups with a start date | W7 | [x] |
| F15 | Classes: management (venues, types, recurring schedules, sessions, roster, attendance, QR) + student booking, waitlist, check-in | W9, M6 | [x] |
| F16 | Club Studio (full) + club settings (data, modalities, terminology, timezone, subdomain, venues) | O1, O3 | [x] |
| F17 | Plan and billing: plans, usage, Stripe checkout (mock), billing portal (mock), invoices, student limit enforcement | O4, O5 | [x] |
| F18 | My account + profile: personal data, zones, connections, notifications, privacy (export, delete account), leave club; notification center (incl. `class_reminder` before booked classes, and a "today's class" card on M1 Hoje) | C1, M7, W11 | [x] |
| F21 | Races and events: club race calendar, students sign up, goal races feed periodization, results | W12, M9 | [x] |
| F22 | Messages: trainer ⇄ student direct chat and club announcements (mural) with read receipts | W13, M10 | [x] |
| F23 | Assessments and tests: physical assessments, performance tests (Cooper, 3 km, CSS, FTP, 1RM) that update zones | W14 | [x] |
| F24 | Challenges and rankings: monthly km, streaks, club leaderboard (opt-in), badges (accent color) | W15, M11 | [x] |
| F25 | Reports and exports: compliance and volume per student/group, attendance for classes, CSV/PDF export | W16 | [x] |
| F26 | Club finances: student monthly fees (Stripe/Pix), status per student, reminders, receipts | O6, M12 | [x] |
| F27 | AI assistant: "describe the workout" → structure, weekly plan suggestions from goal and history, feedback summaries | W17 | [x] |
| F28 | Exercise library with videos for strength/mobility, linked from exercises | W18 | [x] |
| F29 | Import/export: students via CSV, workouts via pasted text, `.FIT` workout export, `.ics` calendar feed for students | — | [x] |
| F30 | Power features: command palette (⌘K), keyboard shortcuts in planning, PWA install, offline today, print-friendly week | — | [x] |
| F20 | Hardening: 404 and error pages, empty states audit, accessibility pass, responsive pass, performance budget (§7.7: initial JS is ~195 KB gzip after F30, lazy-load the remaining eager screens), Playwright e2e suite in CI | — | [x] |
| F31 | Founder revisions (2026-11-02): personal e-mail invites (D-023: 7 days, single use, only the invited e-mail; resend/cancel; dev outbox at `/dev/outbox`) and Runflow-branded public pages (D-024); the invite form sends one person at a time (e-mail + name), bulk stays in the spreadsheet import | A3, A5, O2 | [x] |
| F32 | Founder revisions (2026-11-02): workout hashtags are first-class: `#tag` in quick text and import lines, a tag editor in the builder (it used to drop tags on save), library tag filter and `#` search, `?tag=` + normalization rules in the contract (api/endpoints.md § Tags) | W5, W6 | [x] |

## Phase 2: real backend (`backend/`, Rust) replacing the mock

Founder (2026-11-02, D-025): the backend comes before mobile, so mobile is built on the real API. The backend implements **everything the web app does on the mock**: every row of `api/endpoints.md`, same pt-BR errors and codes, same rules (e.g. § Tags).

| Step | Scope | Status |
|---|---|---|
| S1 | Bootstrap: Cargo workspace, axum `/v1/health`, config from env (`.env.example` lists every variable), sqlx migrations from `api/schema.sql`, problem+json errors (pt-BR), e-mail via Resend (D-026, log fallback), Dockerfile (amd64/arm64), root `docker-compose.yaml` (Postgres + API), backend CI | [x] |
| S2 | Auth (Google, email code), sessions, `/me` | [ ] |
| S3 | Clubs, branding (Rust port of the color engine, golden fixtures), invites, members, groups | [ ] |
| S4 | Workouts, templates, planilhas, completions, comments, feedback | [ ] |
| S5 | Activities + Strava (OAuth, webhooks, sync, consent-based visibility) | [ ] |
| S6 | Scheduling | [ ] |
| S7 | Billing (Stripe Checkout, portal, webhooks), notifications, push | [ ] |
| S8 | `ops/`: Pi deployment, Cloudflare Tunnel, backups, restore drill | [ ] |

## Phase 3: mobile app (`mobile/`) on the real API

| Step | Scope | Status |
|---|---|---|
| X0 | Expo + TS scaffold in the workspace, tokens → RN theme, club theme cache (sync kv-store, D-022) behind the splash (§7.8), API client against the mock | [x] |
| X1 | RN UI kit mirroring `frontend/src/ui` names and variants | [ ] |
| X2 | Sign-in (Google, email code) + deep links for invites | [ ] |
| X3 | Tabs per role + club switcher | [ ] |
| X4 | Student: Today, workout detail, feedback, schedule (offline cache) | [ ] |
| X5 | Activities + Strava connect | [ ] |
| X6 | Classes: booking, waitlist, QR check-in | [ ] |
| X7 | Profile, account, notifications, privacy | [ ] |
| X8 | Trainer on mobile: students, feedback inbox, quick edit of today's workouts | [ ] |
| X9 | Owner/student onboarding on mobile (invite deep link → consent → profile → Strava) | [ ] |
| X10 | Push notifications, widgets (today's workout), Apple Health / Health Connect read | [ ] |

## Later (TODO, not scheduled)

- **Spreadsheet files: `.xlsx` / `.xls` import** for students (Members) and workouts (Library). Today: `.csv` upload or paste from Excel / Google Sheets (F29). Parse in the browser (lazy-loaded, outside the initial-JS budget) or server-side; keep the same preview and per-row errors.

## Feature map (what "done" means per screen)

- **A1 Landing**: live quick-text hero, modalities, builder demo, features, Club Studio demo, pricing, comparison, FAQ, final CTA, demo logins (mock). *Later:* SEO meta + OG image, customer stories, blog, sitemap.
- **A2 Login**: Google, e-mail code (resend cooldown, attempts), redirect back, terms links. *Later:* Sign in with Apple, WhatsApp code.
- **W1 Dashboard**: today's board (who trained, who didn't, what's next), feedback waiting for a reply, alerts (3+ missed in a row, RPE too high, no sync in 7 days, birthdays), compliance trend (8 weeks), this week's volume, upcoming classes and races, onboarding checklist, plan usage, quick actions (new workout, invite, copy week).
- **W2 Students**: search, group filters, sort, compliance, week progress, last activity, Strava status, groups dialog, invite dialog. *More:* bulk actions (assign, add to group, message), tags, CSV export.
- **W3 Student detail**: header (goal, level, race date, WhatsApp), month calendar with completion, activity list, metrics (weekly volume, compliance, pace trend), zones editor (from race/test), profile and private trainer notes, consent status, thread history.
- **W4 Planning**: week grid (students × days), group filter, search, today highlight, chips with status/comments, drag to move, detail (structure, notes, completion, activity, thread), edit, duplicate, remove, assign dialog (library or build now, students/groups, many days, notes), copy week, week totals per student. *More:* multi-select chips, move between students, month view, undo.
- **W5 Builder**: quick text ⇄ structured editor, hashtags (`#tag` in the text or the tag editor), run/swim/bike/strength/mobility, series, targets, swim extras, live summary, examples. *More:* preview with a student's personal zones, AI templates, exercise videos.
- **W6 Library**: search (name or `#tag`), sport and tag filters, cards with profile and tags, duplicate, archive. *More:* folders, usage count.
- **W7 Planilhas**: weeks × days editor reusing the builder, phases (base/build/peak/taper), weekly volume chart, apply to students/groups with a start date, active assignments, unassign future workouts.
- **W8 Feedback**: inbox of completions + comments, unread/flagged filters, quick replies, mark as read, jump to workout.
- **W9 Classes management**: venues, class types, recurring schedules (generate 8 weeks), week view, session roster (booked, waitlist, attended, no-show), add student, cancel session (notify), QR check-in code, capacity changes.
- **M1 Today**: greeting, today's workout(s) with personal targets, mark done + feedback, week strip, next class, last activity, streak/achievements (accent), offline.
- **M2 Workout**: steps with personal paces/zones, notes, send to watch (Garmin, later), mark done, feedback (M5), thread with trainer, linked activity.
- **M3 Schedule**: week and month, workouts + classes, past status.
- **M4 Activities**: list by week with totals, detail (laps, pace, HR, match to plan), manual log, sync status.
- **M6 Classes**: weekly schedule, book, cancel, waitlist position, QR check-in, history.
- **O1 Club Studio**: logo, 0–2 colors, contrast report, suggestions from the logo, live previews (phone + desktop, light + dark).
- **O2 Members**: students/team/invites tabs, suspend, remove, promote, invite links with limits.
- **O3 Settings**: club data, modalities, trainer label, timezone, subdomain (Pro), venues, danger zone (close club).
- **O4 Billing**: plans, usage, upgrade (Stripe Checkout), manage (portal), invoices, cancel, limit messages.
- **C1 Account**: profile, avatar, connections, notification prefs, consents (grant/revoke), data export, delete account, leave club, sessions.
- **W11 Notifications**: list, unread, mark all read, deep links.

## Screen inventory

IDs are used in commits. Routes are English; everything visible is pt-BR.

| ID | Screen | Route (web) | Role |
|---|---|---|---|
| A1 | Landing + preços | `/` (public site) | public |
| A2 | Entrar (Google, código por e-mail) | `/login` | all |
| A3 | Convite (tema do clube) | `/invite/:token` | all |
| A4 | Boas-vindas do aluno: consentimento, perfil, objetivo, Strava | `/welcome` | student |
| A5 | Criar clube: dados → estúdio → convite → biblioteca → pronto | `/clubs/new` | owner |
| A6 | Troca de clube | shell + `/clubs` | all |
| A7 | Sem clube ainda | `/clubs` (empty) | all |
| M1 | Hoje | `/today` | student |
| M2 | Treino | `/workouts/:id` | student |
| M3 | Agenda | `/schedule` | student |
| M4 | Atividades / atividade | `/activities`, `/activities/:id` | student |
| M5 | Feedback do treino (folha) | in M2 | student |
| M6 | Aulas (reservar, lista de espera, check-in) | `/classes` | student |
| M7 | Perfil (zonas, objetivo) | `/account/profile` | student |
| M9 | Provas | `/races` | student |
| M10 | Mensagens | `/messages` | all |
| M11 | Desafios | `/challenges` | student |
| M12 | Mensalidades | `/account/payments` | student |
| W1 | Painel | `/dashboard` | trainer |
| W2 | Alunos + grupos | `/students` | trainer |
| W3 | Aluno | `/students/:id` | trainer |
| W4 | Planejamento | `/planning` | trainer |
| W5 | Construtor de treino | `/library/new`, `/library/:id` (+ dialog in W4) | trainer |
| W6 | Biblioteca | `/library` | trainer |
| W7 | Planilhas | `/plans`, `/plans/:id` | trainer |
| W8 | Feedbacks | `/feedback` | trainer |
| W9 | Gestão de aulas | `/classes/manage` | trainer |
| W11 | Notificações | `/notifications` | all |
| W12 | Provas e eventos | `/races/manage` | trainer |
| W13 | Mensagens e mural | `/messages` | trainer |
| W14 | Avaliações e testes | `/assessments` | trainer |
| W15 | Desafios | `/challenges/manage` | trainer |
| W16 | Relatórios | `/reports` | trainer |
| W17 | Assistente | in W4/W5/W7 | trainer |
| W18 | Exercícios (vídeos) | `/exercises` | trainer |
| O1 | Club Studio | `/club/studio` | owner |
| O2 | Membros e convites | `/club/members` | owner |
| O3 | Configurações do clube | `/club/settings` | owner |
| O4 | Plano e cobrança | `/club/billing` | owner |
| O5 | Checkout / portal Stripe (mock) | `/dev/stripe/*` | owner (mock only) |
| O6 | Mensalidades dos alunos | `/club/finance` | owner |
| C1 | Minha conta | `/account` | all |

Home after sign-in: owner and trainer → `/dashboard`; student → `/today`; no membership → `/clubs`. `/app` sends a signed-in user to their home.
