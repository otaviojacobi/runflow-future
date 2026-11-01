# Build plan: every screen, in order

**How to resume (any session):** read `root.md` §0–§4, then this file. Take the **first unchecked step**, build it, tick its box here, run the checks, then commit and push (founder-authorized). One step is one commit, or a few small ones.
Contract: `api/schema.sql` (DB) · `api/endpoints.md` (API) · `api/mock/` (runnable mock). If a screen needs data that isn't in the contract, **change the contract first** (schema + endpoints + mock) in the same step.

Run everything: `npm install` at the repo root, then `npm run dev`. That starts the mock API on :8787 and the web app on **:8080**, which must always stay running: the founder follows progress there. `/dev/status` shows this plan live.

## Phase 1: web app on the mock API (`frontend/`)

| Step | Scope | Screens | Status |
|---|---|---|---|
| F0 | Scaffold: npm workspaces, Vite + React + TS, Tailwind v4 bound to `@runflow/design` tokens, TanStack Router + Query, i18n (pt-BR source strings), API client + problem+json errors, mock API core (auth, `/me`), `check` script | — | [x] |
| F1 | UI kit `src/ui/*` + domain components `src/components/*`, plus a `/dev/componentes` page (replaces the DS2/DS3 HTML pages) | DS2, DS3 | [x] |
| F2 | Sign-in (Google mock chooser + email code), session, route guards, "no club yet" | A2, A7 | [x] |
| F3 | App shell per role (sidebar on desktop, bottom tabs on phones), club context, club theme without a flash (§7.8), club switcher | A6 | [x] |
| F4 | Owner onboarding wizard: create club → Studio quick step (0–2 colors, logo, live preview) → invite (link, WhatsApp, QR) → starter library → done | A5 | [x] |
| F5 | Invite page (club-themed) + student onboarding: consent → profile and goal → connect Strava (mock) | A3, A4 | [x] |
| F6 | Members and invites (owner); students list + groups (trainer) | O2, W2 | [x] |
| F7 | Workout builder: structured editor + quick text (`10' aquec + 6x1km @4:30 c/ 2' trote`) + intensity preview; run, swim and strength blocks | W5 | [x] |
| F8 | Library (templates by sport, search, duplicate, archive) | W6 | [x] |
| F9 | Planning: students × week grid, assign (athletes or group), drag to move, copy week | W4 | [ ] |
| F10 | Student: Hoje, workout detail, feedback sheet, agenda | M1, M2, M5, M3 | [ ] |
| F11 | Activities (list, detail, manual log) + student detail for trainers | M4, W3 | [ ] |
| F12 | Feedback inbox + comment threads | W8 | [ ] |
| F13 | Trainer dashboard | W1 | [ ] |
| F14 | Planilhas: multi-week editor + apply to students | W7 | [ ] |
| F15 | Classes: management (types, recurring schedules, sessions, roster, attendance) + student booking, waitlist, check-in | W9, M6 | [ ] |
| F16 | Club Studio (full) + club settings (data, modalities, terminology, timezone, subdomain, venues) | O1, O3 | [ ] |
| F17 | Plan and billing: plans, usage, Stripe checkout (mock), billing portal (mock), invoices, student limit enforcement | O4, O5 | [ ] |
| F18 | My account + profile: personal data, zones, connections, notifications, privacy (export, delete account), leave club; notification center | C1, M7, W11 | [ ] |
| F19 | Public landing + pricing (runflow.club) | A1 | [ ] |
| F20 | Hardening: 404 and error pages, empty states audit, accessibility pass, responsive pass, performance budget (§7.7) | — | [ ] |

## Phase 2: mobile app on the mock API (`mobile/`)

| Step | Scope | Status |
|---|---|---|
| X0 | Expo + TS scaffold in the workspace, tokens → RN theme, club theme cache (MMKV) behind the splash (§7.8), API client against the mock | [ ] |
| X1 | RN UI kit mirroring `frontend/src/ui` names and variants | [ ] |
| X2 | Sign-in (Google, email code) + deep links for invites | [ ] |
| X3 | Tabs per role + club switcher | [ ] |
| X4 | Student: Hoje, workout detail, feedback, agenda (offline cache) | [ ] |
| X5 | Activities + Strava connect | [ ] |
| X6 | Classes: booking, waitlist, QR check-in | [ ] |
| X7 | Profile, account, notifications, privacy | [ ] |
| X8 | Trainer on mobile: students, feedback inbox, quick edit of today's workouts | [ ] |
| X9 | Owner/student onboarding on mobile (invite deep link → consent → profile → Strava) | [ ] |

## Phase 3: real backend (`backend/`, Rust) replacing the mock

| Step | Scope | Status |
|---|---|---|
| S1 | Bootstrap: workspace, axum `/health`, config, sqlx migrations from `api/schema.sql`, Docker multi-arch, CI | [ ] |
| S2 | Auth (Google, email code), sessions, `/me` | [ ] |
| S3 | Clubs, branding (Rust port of the color engine, golden fixtures), invites, members, groups | [ ] |
| S4 | Workouts, templates, planilhas, completions, comments, feedback | [ ] |
| S5 | Activities + Strava (OAuth, webhooks, sync, consent-based visibility) | [ ] |
| S6 | Scheduling | [ ] |
| S7 | Billing (Stripe Checkout, portal, webhooks), notifications, push | [ ] |
| S8 | `ops/`: Pi deployment, Cloudflare Tunnel, backups, restore drill | [ ] |

## Screen inventory

IDs are used in commits. Routes are pt-BR (users see them).

| ID | Screen | Route (web) | Role |
|---|---|---|---|
| A1 | Landing + preços | `/` (public site) | public |
| A2 | Entrar (Google, código por e-mail) | `/entrar` | all |
| A3 | Convite (tema do clube) | `/convite/:token` | all |
| A4 | Boas-vindas do aluno: consentimento, perfil, objetivo, Strava | `/bem-vindo` | student |
| A5 | Criar clube: dados → estúdio → convite → primeiro treino → checklist | `/criar-clube` | owner |
| A6 | Troca de clube | shell + `/clubes` | all |
| A7 | Sem clube ainda | `/clubes` (empty) | all |
| M1 | Hoje | `/hoje` | student |
| M2 | Treino | `/treinos/:id` | student |
| M3 | Agenda | `/agenda` | student |
| M4 | Atividades / atividade | `/atividades`, `/atividades/:id` | student |
| M5 | Feedback do treino (folha) | in M2 | student |
| M6 | Aulas (reservar, lista de espera, check-in) | `/aulas` | student |
| M7 | Perfil (zonas, objetivo) | `/conta/perfil` | student |
| W1 | Painel | `/painel` | trainer |
| W2 | Alunos + grupos | `/alunos` | trainer |
| W3 | Aluno | `/alunos/:id` | trainer |
| W4 | Planejamento | `/planejamento` | trainer |
| W5 | Construtor de treino | `/biblioteca/novo`, `/biblioteca/:id` (+ dialog in W4) | trainer |
| W6 | Biblioteca | `/biblioteca` | trainer |
| W7 | Planilhas | `/planilhas`, `/planilhas/:id` | trainer |
| W8 | Feedbacks | `/feedbacks` | trainer |
| W9 | Gestão de aulas | `/aulas/gestao` | trainer |
| W11 | Notificações | `/notificacoes` | all |
| O1 | Club Studio | `/clube/estudio` | owner |
| O2 | Membros e convites | `/clube/membros` | owner |
| O3 | Configurações do clube | `/clube/configuracoes` | owner |
| O4 | Plano e cobrança | `/clube/plano` | owner |
| O5 | Checkout / portal Stripe (mock) | `/dev/stripe/*` | owner (mock only) |
| C1 | Minha conta | `/conta` | all |

Home after sign-in: owner and trainer → `/painel`; student → `/hoje`; no membership → `/clubes`.
