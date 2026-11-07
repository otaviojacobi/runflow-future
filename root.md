# Runflow: root

> **The single entry point for Runflow.** Every work session, human or agent, starts here.
> It holds the *intent* and the *cross-repo decisions* for the company and product.
> Implementation details live in each area's own `CLAUDE.md` and docs (`design/`, `backend/`, `frontend/`, `mobile/`).
>
> Domain: **runflow.club** · Market: **Brazil** · UI language: **Portuguese (pt-BR)** · Hosting: **São Paulo region**
> Status: **Phase 3: the mobile app at parity with the web, on the real API** · Last updated: 2026-11-03

---

## 0. How to use this file

- **Always read §1–§4 and §9.** Then read the section for the area you're working in (§7.x) and the next item in §10.
- **One session = one work item** from §10. A session ends with the code working, tested and committed, and with §10 updated (status and session log).
- **Decisions are sticky.** Don't contradict the decision log (§9) silently. If a decision has to change, say why, update §9 and every section it affects in the same session.
- **This file stays an index, not an encyclopedia.** When a topic outgrows its section, move the detail into `docs/<area>/<topic>.md` in this repo and leave a summary and a link here. Keep this file under ~600 lines.
- The founder's original brief is kept verbatim in Appendix A. When something here is ambiguous, the brief is the tie-breaker for intent.

---

## 1. What Runflow is

Runflow is a **training platform that connects trainers and clubs with their students**, built for the Brazilian market.

- **Trainers and owners** prescribe workouts and training plans (*planilhas*) and follow how their students are doing (class scheduling comes later, D-035).
- **Students** see what to do today, train, and their results sync back from **Strava** (Garmin later).
- **Every club sees its own colors.** Runflow is the app. The *Club Studio* lets a club set its logo and colors, and Runflow displays them to the club's members on web and mobile. This is included on the free tier.
- **More than running.** Runflow serves running clubs (*assessorias*) and also **gyms** (class scheduling later, D-035), **swimming clubs**, and **hybrids** that mix modalities.

## 2. Why we win

We compete on three things. Each one is a commitment we measure, not a slogan.

| Pillar | Commitment (measured) |
|---|---|
| **UX**: easier than anything else | A trainer creates and assigns a structured workout in **< 30 s**. Planning a full week for a group takes **< 2 min**. A new owner goes from sign-up to a branded club with an invite link in **< 5 min**. A student sees today's workout within **1 tap** of opening the app. |
| **PRICE**: simply cheaper | Free for up to 10 students, with all features. Pro is **R$ 19,90/month for up to 30 students** (sisrun: R$ 99/month for 20 students, plus a R$ 79 activation fee). We can afford this because we run modern, lean infrastructure (Rust, one binary, Postgres) and build with agentic coding. |
| **SPEED**: never slow, never down | API p95 **< 100 ms** on reads. Web app interactive **< 1.5 s** on 4G on a mid-range Android. Mobile cold start **< 2 s**. Today's and this week's workouts work **offline**. Full budgets are in §7.7. |

Two structural differentiators sit on top of these:
1. **Multi-modality.** One platform covers prescription (running, swimming, cycling, strength) and, later (D-035), scheduling (gym classes, swim lessons), so hybrid clubs stop paying for two tools.
2. **Club Studio.** Runflow displays each club's logo and colors, even on the free tier.

## 3. Competitive landscape: sisrun

Snapshot from sisrun.com.br (2026-11-01). Re-check before marketing claims.

- **Claims**: 2,000+ *assessorias* and 100,000+ students. It is focused on running.
- **Features**: online training spreadsheet, separate coach and student apps, financial management (students pay fees through the app), GPS sync with automatic feedback, exercise video library, race and event calendar, physical assessment, performance tests and protocols, polls, virtual challenges and races, and "AI features".
- **Pricing**: R$ 99/month for up to 20 students, plus a R$ 79 activation fee. Prepaid. Quarterly, semiannual and annual cycles are available. 7-day trial. Additional coaches cost nothing extra.
- **Support**: WhatsApp, email and a help center, Mon–Fri 08:00–18:00.
- **Not visible**: white-label or club branding, gym or class scheduling, and any modality beyond running.
- **Known pain points** (founder's view and our thesis): it is slow, it crashes, and its UX is dated.

**Our angle:** parity on the core coaching loop first, then win on speed, workout-creation UX, price, branding and modalities. We don't chase their long tail of features (polls, video library, assessments) until the core loop is clearly better.

---

## 4. Product

### 4.1 Customers and the two engines

| Customer | Main need | Engine |
|---|---|---|
| Running clubs (*assessorias de corrida*), triathlon, cycling | Individualized plans, watch sync, feedback | **Prescription** |
| Swimming clubs and schools | Swim sets plus lesson schedules (levels, lanes) | **Both** |
| Gyms and studios (functional, strength, pilates…) | Class schedule, bookings, capacity, check-in; sometimes strength programs | **Scheduling** (+ prescription) |
| Hybrid clubs | Any mix of the above | **Both** |

The product is built on two engines that a club can enable together:

- **Prescription engine (*planilha*).** A trainer builds structured workouts, assigns them to a student or group on a date, and the student executes. The completed activity syncs from the watch, is matched to the plan automatically, and the student adds feedback (RPE/*PSE*, comment). The trainer then reviews compliance.
- **Later (D-035): scheduling engine (*aulas*).** Recurring classes with capacity, instructor and location. Students book, join a waitlist, cancel, and check in (e.g. QR code at the gym). The trainer sees the roster and attendance.

### 4.2 Roles

Membership is **per club**. One person can be a student in club A and a trainer in club B, and the app switches context with a club switcher.

| Capability | Owner | Trainer | Student |
|---|:-:|:-:|:-:|
| Club Studio (logo, colors), billing, subscription plan | ✓ | – | – |
| Invite or remove trainers; club settings | ✓ | – | – |
| Invite students; manage groups | ✓ | ✓ | – |
| Build workouts, library, *planilhas*; assign to students or groups | ✓ | ✓ | – |
| See students' synced activities, feedback, compliance | ✓ | ✓ | own only |
| Manage class schedule and rosters | ✓ | ✓ | – |
| Receive workouts, send to watch, give feedback, connect devices (class booking later, D-035) | – | – | ✓ |

Trainers see **all** students in their club (D-017). The owner is also a trainer by default.

### 4.3 Core features

**MVP: the coaching loop, running first.**
- **Workout builder (structured).** Steps (warm-up, active, recovery, cool-down, rest), repeats, durations (time, distance, open), and targets (pace, HR zone, power, RPE). The builder shows a live intensity chart.
- **Quick-text builder (signature feature).** The trainer types the way they'd write on WhatsApp, e.g. `10' aquec + 6x1km @4:30 c/ 2' trote + 10' desaq`, and gets a structured workout instantly. This is deterministic parsing of Brazilian coaching shorthand; AI is optional later.
- **Library.** Templates, plus copying a workout or week and pasting it onto other students.
- **Planning calendar (web).** Students × days grid. Drag and drop, assign to a group, copy a week.
- **Student "Hoje".** Today's workout, the week strip, and the last synced activity. *Send to watch* comes with Garmin (§5).
- **Auto-matching.** A synced activity is matched to the planned workout, with a compliance indicator, the student's RPE and comment, and a comment thread with the trainer.
- **Zones per student**, set from a test or a recent race result.
- **Week release.** Plan ahead in private, then unlock the week for everyone at once, by hand or on a schedule (D-031).
- **Club Studio** (§4.4), **invites** (§4.5) and **notifications**: every one lands in the app's notification center, and each person switches, per kind, whether it also arrives as a push on their devices, or pauses them all (D-045). No notification e-mails.

**Next:** swim and strength builders (sets, send-off times, equipment; exercises, sets/reps/load), multi-week *planilhas*, groups, trainer analytics, billing.
**Later:** Garmin (activities and send to watch), Sign in with Apple and the iOS App Store release, club finances (students pay monthly fees, which is also a revenue lever for us), race and event calendar, challenges, AI assistant (plan suggestions, free-text-to-workout), Apple Health / Health Connect.

### 4.4 Club Studio (club theming)

**Runflow is the app; the club is the theme (D-018).** Club Studio doesn't build a separate app for each club. It changes how Runflow *displays* to that club's members: logo, colors and name. Store listings, sign-in and the product itself stay Runflow.

| Tier | What the club gets |
|---|---|
| **Free** | Club name, logo, and up to two colors (primary and an optional secondary). The colors theme the **signed-in** app on web and mobile for the club's members. Public pages (landing, sign-in, invite page) always stay in Runflow's brand and show only the club's logo and name (D-024). The club's e-mails (invites) wear its colors (D-036). |
| **Pro** | Everything in Free, for more students. Clubs have no sites or domains of their own (D-042): everyone uses Runflow's app in the club's colors. |

How theming works (D-014; details in `design/`):

| Club sets | Primary (*cor primária*): actions (buttons, active tab, links, focus) | Secondary (*cor secundária*): highlights (records, streaks, achievements) |
|---|---|---|
| nothing | Azul Flow (Runflow default) | Volt (Runflow default) |
| one color | the club's color | derived: same hue, opposite lightness (e.g. red → light coral). A neutral primary (black, white, gray) gets Volt. |
| two colors | the club's primary | the club's secondary |

- For each of the two colors, the engine derives a tonal scale and semantic roles (fill, text on fill, text color, subtle backgrounds, borders, focus ring) for **light and dark mode**. It works in OKLCH and **guarantees WCAG contrast**.
- The club's exact colors are kept for fills whenever possible. Text on a fill switches to white or dark automatically. If white text would fail on the primary, Club Studio suggests a slightly darker variant. If the secondary works better for buttons than the primary, it suggests swapping them.
- Uploading a logo suggests the primary and secondary from it. The Studio previews the result on a phone and a desktop mockup before saving.
- In code the two colors are the `brand` and `accent` tokens. "Secondary" is avoided as a token name because it already names the neutral secondary button.
- The same engine runs in the frontend (live preview), the mobile app (runtime theme) and the backend (stored on save, injected into HTML). Golden fixtures from `design/` keep all three identical. How a saved theme reaches the screen without a flash of Runflow's colors: §7.8.

### 4.5 Onboarding flows

Auth is **Sign in with Google** or an **email one-time code**. There are no passwords. **Sign in with Apple** comes with the Apple Developer account, before the iOS App Store release (D-007). **Joining a club needs a personal invite (D-023):** the owner or a trainer invites an e-mail address, Runflow e-mails a link that is valid for 7 days, works once, and only for the account with that e-mail. There are no club-wide or reusable links. Invites can be resent (new link, another 7 days) or cancelled, and a spreadsheet can be imported to invite many students at once.

1. **Owner creates a club** (target: under 5 minutes).
   - Landing page → "Criar meu clube grátis" → Google or email code → club name, modalities (icon multi-select), city.
   - **Studio quick step:** upload a logo, then pick or accept the suggested color, with a live preview.
   - **Invite step:** invite one person at a time (e-mail plus optional name); the form clears for the next and lists who was invited. Many at once is the spreadsheet import later (can be skipped).
   - **First workout:** pick from ready templates ("Rodagem leve 5 km", "Intervalado 6×1 km"…).
   - Dashboard with an onboarding checklist.
2. **Trainer invited by the owner:** e-mail invite → sign in with that e-mail → accept → lands on the student list.
3. **Student joins.**
   - The invite page (Runflow's brand, with the club's logo and name) says who invited them and to which e-mail ("Marcos te convidou").
   - Sign in with the invited e-mail (another account is told to switch).
   - **LGPD consent**, explicit and highlighted: share training and health data with the club's trainers.
   - Profile basics: full name ("Nome completo"), birth date. The e-mail comes from the invite. Goal and zones are set later in the profile (D-035).
   - **Connect Strava** (Garmin later). Connecting asks for consent to share activities with the club's trainers (§5).
   - Install the app via a deep link, then land on "Hoje".
4. **Multi-club:** a club switcher appears whenever the user has more than one membership.
5. **Limits:** when a free club hits 10 students, the invite page says the club is full and the owner gets an upgrade nudge. **Existing students are never locked out.** We block new joins and give a grace period.
6. **Account deletion** is available in-app (an App Store requirement), along with data export (LGPD).

### 4.6 Pricing

| Plan | Students | Price | Notes |
|---|---|---|---|
| **Free** | 1 owner, 1 trainer, 10 students | R$ 0 | All features, Club Studio included. Marketed as generous. |
| **Pro** | 1 owner, 2 trainers, 30 students | **R$ 19,90/month** | All features, priority support. Annual option to define. |
| **Max** | 1 owner, 5 trainers, 100 students included | **R$ 79,90/month** + R$ 5/month per extra trainer + R$ 0,50/month per extra student | No hard limits; extra seats billed per person (D-043). |
| **Enterprise** | — | Annual license | Self-hosted (same container + Postgres + S3-compatible storage). A small line of business. |

- **Counting rule:** only **active students** count. Owners and trainers are unlimited and free, which matches sisrun.
- **Billing: Stripe (D-016). We're not charging yet.** During the beta every club is free, but plan limits already work in the product. Invoicing (NFS-e) is handled by the founder, outside the product.
- **Future revenue:** a small take rate when clubs collect student fees through Runflow (later, D-027).

### 4.7 Language, locale, glossary

- **Everything user-facing is pt-BR by default (D-013):** the apps, the design system pages, mocks, emails, push notifications and **every error message, including the ones the backend returns**. It is i18n-ready from day one: no hardcoded UI strings. **Internals are English:** code, comments, commits, logs, `root.md` and docs.
- **Formats:** decimal comma (`10,2 km`), 24-hour time, `seg, 3 nov`, pace as `4:30 /km`, swim pace as `1:45 /100 m`, metric units. Each club has a timezone (default `America/Sao_Paulo`). Money is stored as integer centavos.
- **Tone:** close, motivating and direct. Use "você" and sentence case. Buttons are verbs ("Salvar treino", "Enviar para o relógio"). Portuguese runs about 20–30% longer than English, so layouts must allow for it.

| Code (EN) | UI (pt-BR) | Note |
|---|---|---|
| club | clube / assessoria | "clube" in the product; "assessoria" in running marketing |
| owner / trainer / student | gestor(a) / treinador(a) / aluno(a) | Clubs can relabel trainer as *professor(a)* (gyms, swimming) |
| workout / planned workout | treino / treino prescrito | |
| training plan | planilha | **Never write a bare `plan` in code.** Use `TrainingPlan` vs `SubscriptionPlan`. |
| template / library | modelo / biblioteca | |
| interval rep / recovery jog | tiro / trote | e.g. "6 tiros de 1 km" |
| warm-up / cool-down / easy / long run | aquecimento / desaquecimento / rodagem / longão | |
| RPE | PSE (percepção subjetiva de esforço) | |
| class / booking / waitlist | aula / reserva / lista de espera | |
| drill / kickboard / paddles / fins | educativo / prancha / palmar / nadadeira | swimming |
| sets / reps / load / rest | séries / repetições / carga / intervalo | strength |
| mobility (sport) | funcional | Founder (2026-11-03): the `mobility` sport is shown as "Funcional"; the key stays `mobility`. The landing lists Corrida, Natação, Ciclismo, Funcional |

---

## 5. Integrations

**Sync model (D-011).** Each student connects *their own* Strava account to Runflow (Garmin later). When they finish a session, the activity syncs by webhook into **Runflow's training model** and is matched to the planned workout. Trainers then see it inside Runflow.

| Provider | What we use | Constraint that shapes the product |
|---|---|---|
| **Garmin** (Connect Developer Program, free for approved businesses) | **Activity API**: completed activities sync into our training model (push/webhook). **Training API**: publish workouts and plans to the student's Garmin Connect calendar, which syncs to the watch. | **Deferred by the founder** (2026-11-01). The program costs nothing for approved businesses but needs an application, so the deferral is about timing, not cost. It's the only provider that can **send workouts to the watch**. Whether the official API accepts swim and strength workouts is unverified; confirm after approval. |
| **Strava** | Completed activities sync into our training model via webhook. This also covers athletes on Coros, Amazfit, Apple Watch, Polar and others who already auto-upload to Strava. | **Trainers see a student's Strava data only with that student's explicit consent.** The API Agreement (effective 2026-06-01) defines Strava Data as *"all data you access or collect from the Strava API Materials"*, so storing it in our DB doesn't change what it is. Its summary says a user's data *"can only be displayed or disclosed… to that user"*, then adds *"This includes not sharing a Strava user's data with other users, end users of your application, or third parties without explicit consent."* ⇒ We rely on explicit consent and **confirm the coaching use case in writing with Strava** during app review (needed anyway, since new apps start with a small athlete cap). Rate limits and brand guidelines apply. |

**Sync rules**
- **Consent.** Shown at connect time, per provider and per club, e.g. "Compartilhar minhas atividades do Strava com os treinadores do <Clube>". We log who, when, and which version of the text. Students can revoke it in settings, and trainers lose visibility immediately.
- **Provenance.** Every activity stores its `source` (`garmin | strava | manual | file`) and the consent it relies on. If a provider's terms change, we can change visibility per source without migrating data.
- **Disconnect.** Deauthorizing a provider deletes the raw data synced from it. The student's own inputs (RPE, comments) stay.
- **Deduplication (once Garmin is live).** Most Garmin users also auto-upload to Strava, so one session often arrives twice. Match on start time, duration and distance, and prefer the Garmin copy.

- **Extensibility.** A `Provider` abstraction covers connect, ingest activity, push workout, and disconnect/delete data. Next in line: **Apple Health (HealthKit)** and **Android Health Connect** through the mobile app (this also covers Apple Watch, Coros, Polar and others), FIT/GPX/TCX upload, and `.FIT` workout export.
- **Workout format.** Keep the internal workout structure compatible with the **FIT workout model**, so exporting to any device is a mapping rather than a redesign.
- **Respect each provider's terms in AI features.** Check a provider's terms before its data feeds any model.

---

## 6. Design direction

The design system lives in **`design/`**, a deliberately small package (§7.1). This section sets its intent. The founder approved the foundations (D1). Screens are now built directly as the real apps on a mock API (D-020, §6.1).

**Principles**
1. **Runflow is the app; the club is the theme.** Structure, components and voice are Runflow's everywhere. The club's logo and colors sit on top, so students feel at home in their club.
2. **Data is the hero.** Paces, distances and times are big, with tabular numerals.
3. **Thumb-first on mobile, keyboard-friendly on web.** Trainers plan on desktop; students live on their phones.
4. **Perceived speed is a feature.** Use optimistic updates and skeletons, and show a spinner only past 300 ms.
5. **Accessible by default:** WCAG 2.2 AA. The theming engine enforces contrast.
6. **One language, two platforms.** Web and mobile share the same tokens, component names, variants and states, and use platform-native patterns where they differ (dialog vs bottom sheet, sidebar vs tab bar).
7. **Light and dark mode from day one.** Athletes open the app at 5 a.m.

**Initial identity** (a proposal, to be finalized in `design/` with a showcase page)
- **Azul Flow `#4B4FE8`**: Runflow's default primary color, used by clubs that set no colors. White text on it is 5.9:1.
- **Volt `#CFF846`**: Runflow's default secondary color, for highlights only (records, streaks, achievements, the logo mark). Never used for text.
- **Ink**: cool neutrals (hue ~265) from near-white to near-black. Status colors are success, warning, danger and info.
- **Training zones Z1–Z5** follow the watch convention: gray `#9CACC1` → blue `#3496EF` → green `#3FC168` → orange `#F8962D` → red `#ED4042`. Data-viz only.
- **Sports:** run `#955BE3`, swim `#00A2C5`, bike `#E3AE28`, strength `#DB428C`, mobility `#26B094`. Always shown with an icon and label, never color alone.
- **Type:** **Archivo** for display (its variable *width* axis gives expanded, athletic headlines and big numbers) and **Inter** for UI (tabular figures). Fonts are self-hosted, with no Google Fonts CDN in production, for speed and LGPD.
- **Icons:** Lucide, which ships both React and React Native packages, plus custom sport icons on the same grid.
- **Spacing and shape:** 4 px spacing grid. Radii: 10 for controls, 14 for cards, 20 for sheets. Controls are 40 px tall on web and 48 px on mobile for primary actions.

### 6.1 Screens

The design system was approved after D1. The HTML-mock phase (D-015) was replaced by building the real web app, then the mobile app, against a mock API (D-020). **The full screen inventory, routes and build order live in [`docs/build-plan.md`](docs/build-plan.md).** Component pages (DS2/DS3) become a `/dev/components` route in the web app.

---

## 7. Architecture

### 7.1 Repository layout

**One repository for now:** [`github.com/otaviojacobi/runflow-future`](https://github.com/otaviojacobi/runflow-future). Each top-level folder is an **area** that maps 1:1 to a future standalone repo. Splitting one out must stay a mechanical operation (`git subtree split --prefix=<area>` or `git filter-repo --subdirectory-filter <area>`, which keeps history).

```
runflow-future/
├── root.md          ← this file: intent, decisions, roadmap
├── docker-compose.yaml, .env.example ← run Postgres, Valkey, Garage + the API locally (QA: ops/qa)
├── docs/            ← cross-cutting detail; docs/build-plan.md = screen-by-screen plan and status
├── api/             → the CONTRACT: schema.sql (DB) · endpoints.md (API) · mock/ (db.json + mock server)
├── ops/             ← Pi deployment, backups, restore runbooks (S8)
├── design/          → future runflow-design (package + showcase/ + mocks/)
├── backend/         → future runflow-backend
├── frontend/        → future runflow-frontend
└── mobile/          → future runflow-mobile
```

**Rules that keep areas splittable**
- Each area is self-contained: its own `CLAUDE.md`, its own `check` command, and its own CI workflow (GitHub Actions filtered by path).
- **No reaching into another area's source** (no `../backend/src/...` imports). Areas consume each other only through the contracts below: by package name, or through a generated artifact.
- Tooling at the repo root stays minimal. A JS workspace file linking `design`, `frontend` and `mobile` is fine. Shared build logic that would break a split is not.

| Area | Purpose | Stack | Consumes | Produces |
|---|---|---|---|---|
| **root** (`root.md`, `docs/`, `ops/`) | Intent, product/design/engineering basis, decision log, roadmap, deployment | Markdown, Docker Compose | Images and bundles from the areas | — |
| **`design/`** | **Small and framework-agnostic.** Design tokens (source of truth), the club-theme color engine, generated outputs, fonts, icons, a showcase page, and component *specs* (names, variants, states, anatomy). **No React or RN components**, because DOM and native primitives differ. Also holds `showcase/` and `mocks/` (§6.1), which aren't part of the published package. | `tokens.json` + a zero-dependency build | — | **`@runflow/design`** package: CSS variables, TS tokens, theme engine, assets. **Golden color fixtures** (JSON) for ports. |
| **`backend/`** | API, background worker, integrations, migrations. Serves the web-app shell with the club theme injected. | Rust · axum/tokio · sqlx · PostgreSQL | Golden color fixtures (to test the Rust theme port) | **OpenAPI 3.1 spec** (committed as `backend/openapi.json`). Multi-arch container image (arm64 + amd64) and a single binary. |
| **`api/`** | **The contract (D-020).** `schema.sql` (PostgreSQL), `endpoints.md` (REST catalog), `mock/` (a zero-dependency mock server over `db.json`). The apps are built against the mock; `backend/` implements the same contract later. | SQL, Markdown, Node (mock) | — | DB schema, API catalog, mock server on `:8787` |
| **`frontend/`** | Web app (trainer-heavy desktop, responsive for students). Later, the marketing site for `runflow.club`. | React · TypeScript · Vite (SPA) | `@runflow/design`, OpenAPI | Static bundle |
| **`mobile/`** | iOS and Android app (all roles in one app). | Expo (React Native) · TypeScript | `@runflow/design`, OpenAPI | Store builds and OTA updates |

**Contracts**
- **Design → apps:** the `@runflow/design` package, imported by **package name** (linked as a workspace package for now). After a split it becomes a published, versioned package and only the dependency line changes.
- **Backend → apps:** the OpenAPI spec. Each app generates its own typed client (`openapi-typescript`) from it. Prefer additive changes; breaking changes need a new version path.
- **Producer first.** A change that crosses areas lands in the producer (design or backend) first, then in consumers, ideally as separate commits.
- **No "shared" area until duplication actually hurts.** The likely first candidate is the quick-text workout parser. Alternatives: keep it in `frontend/`, or expose it as a backend endpoint.

```mermaid
flowchart LR
  subgraph clients[Clients]
    W["Web app<br/>React SPA"]
    M["Mobile app<br/>Expo / React Native"]
  end
  CF["Cloudflare<br/>DNS · TLS · CDN · Tunnel"]
  subgraph host["Raspberry Pi → AWS sa-east-1"]
    API["runflow binary<br/>axum API · web shell · worker"]
    PG[("PostgreSQL<br/>records · job queue")]
    KV[("Valkey<br/>codes · limits · caches")]
    OBJ[("Object storage<br/>disk → S3")]
  end
  ID["Google / Apple Sign-In"]
  G["Garmin APIs"]
  S["Strava API"]
  W --> CF
  M --> CF
  CF --> API
  API --> PG
  API --> KV
  API --> OBJ
  API --> ID
  API <--> G
  API <--> S
```

### 7.2 Backend (`backend/`)

- **Rust, axum + tokio, sqlx + PostgreSQL.** Compile-time checked queries, with migrations managed by sqlx.
- **Modular monolith.** A Cargo workspace splits code into `domain` (pure types and rules, no I/O), `db`, `kv` (Valkey), `api`, `integrations` and `jobs`. One binary has subcommands `all | serve | migrate | doctor | email-test | healthcheck` (`worker` arrives with the job queue); Docker and the Pi run `all`. S1 ships `api`, `db`, `integrations` and the binary; `domain` and `jobs` come with the first step that needs them.
- **Background jobs** run on a Postgres queue (`FOR UPDATE SKIP LOCKED`), enqueued in the same transaction as the write that causes them; a `NOTIFY` delivered on commit wakes the worker at once (D-009, D-047). Jobs never go to Valkey.
- **Valkey (Redis protocol) holds only ephemeral and cache data (D-047):** sign-in codes, rate-limit counters, a 60 s cache of the session lookup and briefly cached heavy club reads (dashboard, reports). Every key has a TTL and no persistence is needed: losing Valkey loses nothing that matters. Records and the job queue stay in Postgres (D-009).
- **Object storage** goes through the `object_store` crate: local disk on the Pi, S3 in the cloud. Uploads are served from a separate host, images are resized server-side, and SVGs are sanitized or rasterized.
- **API conventions.** REST + JSON under `/v1`. OpenAPI is generated from code (utoipa). Errors follow RFC 9457 (problem+json): `title` and `detail` are **pt-BR**, written for the person who reads them, plus a stable English `code` (e.g. `workout.not_found`) for the apps to branch on. Server logs stay in English. Pagination uses cursors. IDs are UUIDv7. Timestamps are `timestamptz` in UTC. Workouts are scheduled on a **local date** plus the club's timezone.
- **Multi-tenancy.** One database with `club_id` on every club-scoped row. Club routes take the form `/v1/clubs/{club_id}/…`. An extractor checks membership and role on every request. Postgres RLS as defense-in-depth will be decided at bootstrap.
- **Workout structure** is stored as versioned JSONB, strongly typed in Rust: steps, repeats, durations and targets per sport, FIT-compatible.
- **Web shell.** The SPA is static (Cloudflare's edge on QA, Pages in production); the club's theme comes from the `rf_club` cookie/localStorage before the first paint (§7.8). Hashed assets are cached at the CDN.
- **Lambda-ready.** No local state (shared counters and caches live in Valkey), config via environment variables, and `lambda_http` can wrap the same router later.
- **Observability:** `tracing` with JSON logs, Prometheus metrics, and Sentry-compatible error reporting.

### 7.3 Auth and authorization

- **Google (OIDC) + email one-time code now; Apple when the Apple Developer account exists. No passwords.**
- **Web.** Sign-in happens on the fixed host `app.runflow.club` (Google OAuth origins can't be wildcards): Google Identity Services gives the page an ID token, `POST /v1/auth/google` verifies it, and the server sets the session cookie. The session cookie is set on `.runflow.club` (HttpOnly, Secure, SameSite=Lax), which gives single sign-on across club subdomains. Custom domains (later) will use a one-time-code handoff.
- **Mobile.** The native Google sign-in SDK (Apple's later) returns an ID token. The backend verifies it against the provider's JWKS and issues an opaque session token, which the app keeps in secure storage and sends as a Bearer token.
- **Sessions.** Opaque random tokens, stored hashed and revocable. Web and mobile use the same model. Lookups are cached in Valkey for up to 60 s; signing out, revoking and deleting the account drop them at once (D-047). E-mail codes live only in Valkey, hashed, for their 10 minutes.
- **Apple requirements.** App Store guideline 4.8 requires a privacy-focused login next to Google, which Sign in with Apple satisfies. In-app account deletion is also mandatory. Both need the Apple Developer Program membership, which the founder has deferred, so the iOS App Store release waits for it.
- **Authorization** is checked server-side on every request, from the membership's role in the target club (§4.2).

### 7.4 Web frontend (`frontend/`)

- **React + TypeScript + Vite SPA**, with TanStack Router and TanStack Query.
- **Styling:** Tailwind CSS v4 bound to the `@runflow/design` CSS variables. Accessible primitives come from Radix or React Aria.
- **Forms and text:** react-hook-form + zod; i18next with a pt-BR catalog.
- **No SSR and no Node server in production.** The Rust binary and the CDN serve everything, and SEO only matters for the marketing site, which is a separate static build.
- **Budgets:** ≤ 200 KB gzip initial JS on student routes, with code splitting per route.
- **Why not Next.js:** it would need a Node runtime on the Pi and a second backend. An app behind login doesn't need SSR.

### 7.5 Mobile (`mobile/`)

- **Expo (React Native, new architecture) + TypeScript + Expo Router.**
- **One app for all roles,** with navigation that depends on the role. sisrun ships two apps.
- **Theming:** the club theme is applied at runtime from the `@runflow/design` engine.
- **Offline first:** today's and this week's workouts are cached (persisted query cache).
- **Platform features:** push notifications, native Google sign-in (Apple later), EAS Build and OTA updates. HealthKit and Health Connect come later.
- **Stores:** Android ships first. The iOS App Store release waits for the Apple Developer account (D-007).
- **Why Expo over Flutter:**
  - It shares TypeScript, tokens and the generated API types with the web app.
  - It is fast with the new architecture and Hermes.
  - OTA updates let us ship fixes quickly.
  - Agents are very fluent in it.
- **Styling (D-021):** React Native `StyleSheet` plus a typed theme built from `@runflow/design` tokens; club roles come from the same color engine at runtime. No NativeWind or Unistyles.

### 7.6 Infrastructure and hosting

| Phase | Setup |
|---|---|
| **QA (now)** | The founder's **Raspberry Pi** at `qa.runflow.club`: Docker Compose runs the `runflow` binary, PostgreSQL, Valkey (no persistence, D-047) and Garage (S3), the web app is served from Cloudflare's edge, traffic comes in through a **Cloudflare Tunnel**. **Disposable (D-039):** no backups, wiped whenever the schema changes, security kept simple. It exists to try every building block end to end. |
| **Production (D-053)** | **One AWS EC2 instance running QA's compose** (API + worker, PostgreSQL, Valkey, the web container, Umami) behind a Cloudflare Tunnel; uploads in S3 (or Garage), Grafana Cloud for metrics and logs, Sentry for errors; managed databases only once revenue pays for them, then a paid account, a bigger instance or Kubernetes. Set up in P1. *Replaced (D-040):* **API on AWS Lambda** (the same `runflow` binary behind the Lambda runtime; the worker as scheduled invocations), **web app on Cloudflare Pages**, **Aurora PostgreSQL** (its automated backups and point-in-time restore), **ElastiCache for Valkey** in the VPC (D-047), S3 for uploads, **Grafana Cloud** (free tier) for metrics and logs, **Sentry** for errors, **Stripe** live, **Resend** for e-mail. Region São Paulo (sa-east-1). Set up in its own session (P1); until then every piece stays pluggable through settings. |
| **Enterprise** | The same image, Postgres, Valkey, and any S3-compatible store, shipped as a docker-compose bundle with a license key. |

- **Pluggable by settings:** database URL, Valkey URL (`REDIS_URL`), S3 endpoint, e-mail provider, Stripe, Sentry, telemetry endpoint and push keys all come from the environment, so QA, local dev and production run the same code (§7.2 "Lambda-ready").
- **Production before real clubs:** the private beta runs on production (P1), never on the Pi.

### 7.7 Non-functional requirements

| Area | Target |
|---|---|
| API latency | p95 < 100 ms (reads), < 250 ms (writes) at the edge of our host |
| Web | Interactive < 1.5 s on 4G on a mid-range Android. ≤ 200 KB gzip initial JS (student routes). |
| Mobile | Cold start < 2 s. Today's and this week's workouts offline. 60 fps lists. |
| Availability | 99.5% on the Pi (beta), 99.9% in the cloud. RPO ≤ 5 min, RTO ≤ 2 h. |
| Security | Provider tokens encrypted at rest, secrets only in the environment, rate limiting, audit log for owner and admin actions, no user-uploaded active content (SVG sanitized). |
| LGPD | Health data is **sensitive personal data** (art. 11), so we need explicit consent, export and deletion, and a published DPO (*encarregado*). The club is the controller of its students' training data and Runflow is the operator, which the terms and DPA must reflect. Data stays in Brazil. |

### 7.8 Club theme delivery (no flash of Runflow colors)

**What's stored.** The DB keeps only what the owner chose: `primary` and `secondary` (each optional), the logo asset and the club name. Alongside them it keeps `theme_rev` (bumped on every save) and `engine_version`. On save, the backend runs its Rust port of the color engine, checked against `design/dist/color-fixtures.json`. It stores the result next to the inputs: the resolved colors, every role for light and dark as JSON, and the ready-made CSS block. Clients never recompute a saved theme; they only run the engine for Club Studio's live preview. Fonts, spacing, components and data colors are not in the DB. They ship with the apps (§4.4, D-018).

**API.** `GET /v1/clubs/{id}/theme` returns `{ rev, primary, secondary, source, logo, css, roles: { light, dark } }` with `ETag: "<rev>"`, so most refreshes are a `304`. The same payload is embedded per membership in `GET /v1/me`, so the apps have every club's theme right after login without extra calls. Logo URLs are content-hashed and cached forever.

**Web: the first paint is already themed.**
1. **One host for everyone** (`app.runflow.club`; no club sites, D-042). A small, non-secret `rf_club` cookie remembers the last active club, and the server inlines that club's theme the same way. Without the cookie, a tiny inline script applies the theme saved in `localStorage` before the first paint. This is the same trick that avoids a dark-mode flash.
2. **Public pages** (landing, sign-in, invite page, club picker, club creation) always render in Runflow's brand (D-024): the cached club stylesheet is present but disabled on those paths, so entering the app switches to the club's colors instantly.
3. **Revalidation.** After load the app checks the theme's ETag. If `rev` changed, it swaps the CSS variables in place, with no reload.

**Mobile: the first frame is already themed.**
1. The active club's theme (colors and `rev`) is persisted in a synchronous key-value store (`expo-sqlite/kv-store`, D-022), read before the first frame. The logo stays in the image disk cache.
2. The native splash screen (Runflow's, since Runflow is the app) stays up until the session and the cached theme are loaded, which takes milliseconds. The first rendered frame has the club's colors.
3. On launch and on returning to the foreground, the app revalidates with the ETag and applies a changed theme live, without a restart.
4. A fresh login with no cache gets every theme inside `GET /v1/me` before the home screen renders.

**Club switch:** themes for all of a user's clubs are cached, so switching is instant and works offline.
**Engine changes:** a new `engine_version` triggers a background job that recomputes every stored theme and bumps `theme_rev`. Clients pick it up on their next revalidation.

---

## 8. Engineering conventions (all repos)

- Every area has a `CLAUDE.md`, a single `check` command (format, lint, typecheck, test), and CI that must pass before merge.
- **No AI attribution in git history.** Commits and PRs never carry `Co-Authored-By:` trailers for AI tools, "Generated with …" footers, or any other mention of an assistant as author or contributor. The founder is the only author.
- **Never hardcode colors, spacing, radii, fonts or durations.** Always use `@runflow/design` tokens.
- **Never hardcode UI text.** Use i18n keys with pt-BR as the source language. Error messages are UI text too, including backend errors (§4.7, §7.2).
- Small commits and PRs (conventional commits). Each session leaves the repo in a working state.
- Tests: the backend tests against a real Postgres and a real Valkey (no DB mocks). Web uses component tests plus Playwright e2e. Mobile uses component tests plus Maestro e2e.
- Performance budgets from §7.7 become automated checks as soon as the code exists.
- New dependencies need a one-line justification. Architectural changes update §9.

---

## 9. Decision log

| # | Decision | Why | Status |
|---|---|---|---|
| D-001 | Single repo for now ([runflow-future](https://github.com/otaviojacobi/runflow-future)), with top-level areas `design/`, `backend/`, `frontend/`, `mobile/` that map 1:1 to future repos | Simplest to start; atomic cross-area changes; small contexts per area for agents; a mechanical split later (§7.1) | Accepted (founder) |
| D-002 | Backend in Rust (axum/tokio) + PostgreSQL (sqlx) | Speed, low cost per user, runs on a Pi, maps cleanly to AWS | Accepted (founder) |
| D-003 | `design/` is small and framework-agnostic: tokens + theme engine + assets + specs, no components | Both apps consume it; DOM and RN components can't be shared well | Accepted (founder) |
| D-004 | Web: React + TS + Vite SPA, no SSR | No Node server in production; app is behind login | Proposed |
| D-005 | Mobile: Expo (React Native) + TS, one app for all roles | Fast, shares TS/tokens/types with web, OTA updates | Proposed |
| D-006 | Contracts: `@runflow/design` package (design), OpenAPI (backend); no cross-area source imports | Typed boundaries that survive a repo split | Proposed |
| D-007 | Auth: Google + email code now; Apple when the Apple Developer account exists (before the iOS App Store release); opaque hashed sessions; no passwords | Best UX, revocable; the founder deferred the Apple account | Accepted (founder) |
| D-008 | Multi-tenancy: shared DB, `club_id` scoping, per-club roles | Simple, cheap, supports multi-club users | Proposed |
| D-009 | Jobs on Postgres (`FOR UPDATE SKIP LOCKED`, enqueued in the writer's transaction, woken by `NOTIFY`). Updated 2026-11-03: a Valkey service now exists for ephemeral and cache data only (D-047); jobs never move there | Jobs commit or roll back with the write that causes them; one fewer moving part for the queue | Accepted (jobs on Postgres); the original "no Redis" replaced by D-047 |
| D-010 | Object storage via `object_store`: disk (Pi) → S3 (cloud) | Zero extra services now, config-only migration | **Superseded by D-037** |
| D-011 | Students connect their own provider accounts (**Strava at launch; Garmin deferred**). Activities sync into Runflow's training model, and trainers see them with the student's explicit, per-club, revocable consent. Provenance is kept per activity. **Strava sharing (founder, 2026-11-04):** the connection exists for the trainers, so sharing is on by default and required to connect (only a club's student can connect; connecting shares Strava with every club where they're a student, the statement shown checked); it stays revocable per club with a warning, and staff are told by the `sharing_off` dashboard alert; a change that leaves no club seeing the sync (revoke, leave, suspension, removal, club closed) disconnects Strava (deauthorized, its activities deleted). Brand rules: `docs/strava-brand.md` | Founder's sync model. Strava's agreement forbids sharing with other users *without explicit consent*. Runflow's Strava athlete seats are limited: someone syncing without sharing wastes one | Accepted (founder); confirm with Strava in writing |
| D-012 | Hosting: Pi + Cloudflare Tunnel → AWS sa-east-1 | Near-zero cost now; Brazilian data residency | Accepted (founder) |
| D-013 | Everything user-facing is pt-BR by default: apps, design system pages, mocks, emails, notifications and all error messages, backend included. i18n-ready. Code, comments, commits, logs and docs in English | Market focus without future rewrites | Accepted (founder) |
| D-014 | Club theming takes 0, 1 or 2 colors (none: Runflow defaults; one: derived secondary; two: primary + secondary) and produces an accessible light/dark theme. Same engine in all areas (golden fixtures) | Most clubs have two colors; contrast and coherence are never left to chance | Accepted (founder) |
| D-015 | Design first ("waterfall"): mock the whole UI as HTML before implementing | Validate look and flows cheaply | **Superseded by D-020** after D1 approval |
| D-020 | Contract first: `api/schema.sql` + `api/endpoints.md` + a mock server over `api/mock/db.json`. Build the real web app on it screen by screen, then the Rust backend implements the same contract, then mobile (order per D-025) | Real, testable UI early; the backend can't drift from what the screens need | Accepted (founder) |
| D-021 | Mobile styling: `StyleSheet` + a typed theme generated from `@runflow/design` tokens (club roles via the shared color engine) | One token source with the web, no styling dependency, works in Expo Go | Accepted (engineering, 2026-11-02) |
| D-022 | Mobile caches: club theme and preferences in `expo-sqlite/kv-store` (synchronous, in Expo Go); session token in `expo-secure-store`. Web preview uses `localStorage` | MMKV needs a custom dev build; the kv-store keeps the first frame themed without one | Accepted (engineering, 2026-11-02) |
| D-023 | Joining needs a **personal invite**: one per e-mail, sent by e-mail, valid 7 days, single use, and only the account with that e-mail can accept. No club-wide or reusable links, invite QR codes or WhatsApp sharing | Founder: invites must not be permanent and must be tied to the invited person | Accepted (founder, 2026-11-02) |
| D-025 | **Backend before mobile.** Phase 2 is the Rust backend implementing the whole contract (everything the web app does on the mock); mobile follows on the real API | Validates the 55-table contract on a real database before more clients depend on it; real sign-in, e-mail, Strava and Stripe need a server; mobile skips mock-only work | Accepted (founder, 2026-11-02) |
| D-026 | Transactional e-mail (sign-in codes, invites, account setup; no notification e-mails since D-045) via **Resend**, behind an `EmailSender` trait; without an API key the backend logs e-mails instead (dev). Config only in `.env` | Founder has an account; simple API; swappable (SES in the cloud phase) | Accepted (founder, 2026-11-02) |
| D-027 | **No club-fee payments in v1.** Students don't pay their club through Runflow; clubs keep collecting fees their own way. Fee plans, charges, checkout and receipts (built in F26) are on the later list | Founder: too much for a first version (Stripe Connect onboarding, money flows, support) | Accepted (founder, 2026-11-02) |
| D-028 | **QA = the beta environment on the founder's Raspberry Pi**, at `qa.runflow.club` (`runflow.club` redirects there, 302). Cloudflare DNS + Tunnel; the web container serves the app and proxies `/api` (same origin); arm64 images from GitHub Actions; the Pi pulls `:qa` every 5 minutes. After the beta: a cloud (maybe k8s) | Founder, 2026-11-02 | Accepted (founder, 2026-11-02) |
| D-029 | **QA club subdomains are one level: `<club>-qa.runflow.club`** (not `<club>.qa.runflow.club`). Production never accepts a club subdomain ending in `-qa` | Cloudflare's free certificate covers only `*.runflow.club`; two levels need ACM (US$10/month). The suffix keeps QA and production apart | Superseded by D-042 (2026-11-03) |
| D-030 | **Data is disposable until the private beta.** QA can be wiped at any time (`ops/qa/reset-db.sh`). There is **one migration, `0001_bootstrap.sql`, a synced copy of `api/schema.sql`**, edited in place; when it changes, QA starts over with an empty database by itself (`ops/qa/update.sh`). No backwards compatibility. At the beta: freeze the bootstrap and return to one migration per change, expand-then-contract (`docs/hosting.md` §3) | Founder (2026-11-02): "everything for now is discardable", then "nuke the QA db and simplify the migrations" | Superseded by D-051 (2026-11-04) |
| D-031 | **Week release ("liberar semana").** Trainers plan ahead in private and unlock a week when it's ready: a club setting chooses `immediate` (visible on save, as before) or `weekly` (future weeks stay drafts until released, per week for everyone or chosen groups/students, or automatically at a club-set weekday and time, default Sunday 18:00). A week that has started is always visible. Drafts never reach the student (Hoje, Agenda, notifications, auto-matching); a release sends one `week_released` notification per student instead of one per workout. Detail in F34 | Founder (2026-11-02): trainers want to do all the training and "unlock" it at the end of each week. Defaults are an engineering proposal | Accepted (founder intent) |
| D-032 | **Notification control for every user.** Per notification kind: in-app, push and e-mail on/off, and "instant" or a daily digest; quiet hours for push; trainers can limit feedback/comment notices to chosen groups. Role-aware defaults: students instant, trainers get feedback/comments/new members as a digest. Replaces the four booleans in `notification_prefs`. Detail in F35 | Founder (2026-11-02): a big club easily overwhelms a trainer | **Superseded by D-045** (2026-11-03) |
| D-033 | **Observability:** errors to Sentry (backend, web, later mobile; **free features only: errors, no tracing, replay, profiling or logs**; org `runflow-zw`; DSNs set by the founder as API settings, the web app's handed out by `/public/config`; user id only, no personal data); metrics, traces and logs to Grafana Cloud's free tier (D-040: pushed over OpenTelemetry, which also works on Lambda; JSON logs). Steps S12–S13 | Founder (2026-11-02): needed before real clubs, can come after the product steps | Accepted (founder) |
| D-034 | **Smoke tests against deployed environments.** A small Playwright suite runs the main loop against QA after every deploy (and production later): sign in, create a throwaway club, invite and accept a student, assign and release a week, the student sees and completes it, the trainer sees the feedback, the club is deleted. Sign-in uses accounts on `smoke.runflow.club` (never delivered): with the secret `SMOKE_KEY` header the API returns their code instead of e-mailing it. Step S11 | Founder (2026-11-02): know the main operation works where people use it, not only in CI | Accepted (founder) |
| D-035 | **Simpler beta (founder, 2026-11-02).** Removed completely, like D-027 (screens, menus, mock, contract and tables; the code stays in git history): **class scheduling ("Aulas")** and **"Desafios"** (challenges, monthly ranking, badges). Kept: messages and mural, reports, assistant, races, assessments. Students get a 4-item bottom bar (Hoje, Agenda, Mensagens, Perfil); "Atividades" moves inside Perfil. Gym tools are tailored: the exercise library screen shows only to clubs that teach musculação; any club can still type exercise names (with suggestions) in the builder. Onboarding drops the goal step | Too many features confused the first users; make the Agenda great instead | Aulas superseded by D-052 (2026-11-04); Desafios stay removed |
| D-036 | **Club e-mails wear the club's Studio colors** (invites; notices and digests went away with D-045): header, buttons and accents use the club theme, with the club's logo and name, and Runflow is credited only in the footer. E-mails not tied to a club (sign-in codes, account) stay in Runflow's brand. Supersedes the e-mail part of D-024; public *pages* stay Runflow's | Founder (2026-11-02): an invite should feel like it comes from the club | Accepted (founder) |
| D-037 | **Object storage is S3-compatible everywhere**: **Garage** (self-hosted, Rust, arm64) in local dev and on the Pi; production points the same settings at any S3 (AWS, R2…). The disk backend stays for tests only. Supersedes D-010 | Founder (2026-11-02): run what production will run; MinIO has been in maintenance mode with no official images since Oct 2025 | Accepted (founder) |
| D-038 | **Logo: "Ritmo"**, a workout's intensity profile (easy, hard, recovery, the hardest in Volt) on the Azul Flow tile. Always Runflow's colors, never a club's (D-018). Source `design/src/logo.js` (48-grid geometry + SVG); `npm run icons` renders the web and mobile icons; e-mails draw it in HTML from `design/dist/logo.json` | Founder's pick among four concepts on `/dev/logo` (2026-11-03) | Accepted (founder) |
| D-039 | **QA is disposable and low-stakes (founder, 2026-11-03).** No backups, restore drills or off-site copies for QA; its database and storage can be wiped at any time; its security stays simple (shared Pi access is fine). Durability and hardening belong to production (D-040) | Founder: "we don't care about QA"; focus on building blocks | Amended by D-051 (2026-11-04): QA's data is kept and backed up nightly |
| D-040 | **Production target (founder, 2026-11-03):** API on **AWS Lambda**, web app on **Cloudflare Pages**, **Aurora PostgreSQL**, S3, **Grafana Cloud** free tier (metrics, logs, alerts), **Sentry**, **Stripe**, **Resend**. Set up in a dedicated session (P1). Until then the code stays pluggable through settings, and telemetry is pushed (OTLP) rather than scraped; making the binary run as a Lambda is part of P1 (founder: production work waits for that session). Replaces the Pi as the production plan (D-012) | Founder decision | Superseded by D-053 (2026-11-05): one EC2 instance running the compose |
| D-041 | **QA observability is self-hosted (founder, 2026-11-03):** Grafana + Loki + Prometheus with Grafana Alloy collecting, in QA's compose, at `grafana-qa.runflow.club` (admin login in QA's `.env`). Alloy reads every container's logs from Docker, receives the API's OTLP metrics and adds the Pi's host metrics; a "Runflow QA" dashboard is provisioned. Grafana Cloud is for production only (D-040). Infrastructure names (`grafana`, `prometheus`, `loki`…) are reserved subdomains | Founder decision | Accepted (founder) |
| D-042 | **No club sites or custom domains (founder, 2026-11-03):** clubs don't get `<club>.runflow.club` or any address of their own; everyone signs in on Runflow's app and sees the club's colors after choosing it. Removed completely (contract, backend, web, QA settings). Pro is "more students and priority support". Supersedes D-029 and the subdomain part of §4.6 | Founder: hard to build and maintain, low return | Accepted (founder) |
| D-043 | **Plans by seats (founder, 2026-11-03; B2–B4):** Free 1 owner + 1 trainer + 10 students; Pro 1 owner + 2 trainers + 30 students (R$ 19,90/month); Max 1 owner + 5 trainers + 100 students included (R$ 79,90/month), extra seats R$ 5/month per trainer and R$ 0,50/month per student. A failed payment leaves 7 days of grace, then the club freezes for staff (icy overlay, only path is payment; writes answer 423); students never see it. Catalog: `api/plans.json` | Founder decision (prices set 2026-11-03) | Accepted (founder) |
| D-045 | **Notifications are push only (founder, 2026-11-03; N1):** no notification e-mails at all, no instant notices and no daily summary ("resumo"), for students and trainers alike: **no e-mail besides sign-in codes, account setup and invites**. Everything always shows in the app (center, unread count); people only switch push on their devices on or off per kind, plus "Pausar tudo". No quiet hours or group filters. Push defaults (founder, 2026-11-04): on for `week_released` and `workout_changed` (students), `feedback`, `member_joined` and `billing` (staff); off for `workout_assigned`, `comment`, `message` and `announcement`, whose unread count shows on Mensagens instead. Supersedes D-032. Also: the calendar sync (`.ics` feed) goes away (F39) | Founder: simpler, intuitive control | Accepted (founder) |
| D-046 | **QA moves to an Intel NUC (amd64) (founder, 2026-11-03):** the Pi's power supply corrupts SD-card writes. Images build for amd64 and arm64 on native runners until the move, then amd64 only. Same compose, scripts and tunnel token; QA data starts fresh (D-039) | Founder decision | Accepted (founder) |
| D-047 | **Valkey for ephemeral and cache data; Postgres stays the system of record and the job queue (founder, 2026-11-03; S17).** Valkey (`valkey/valkey:8.1.11-alpine` in dev, QA and CI; the open-source Redis fork, same protocol) with every key under a TTL and no persistence holds: sign-in codes (keyed hash + attempts; the `email_codes` table is gone), rate-limit counters (codes per address, the assistant), a 60 s cache of the session lookup (every way a session ends drops it), and briefly cached heavy club reads (W1 dashboard 30 s, W16 report 5 min; keys carry a per-club version that every club write bumps). Jobs stay in Postgres because they're enqueued in the same transaction as the write that causes them, which Valkey can't give; the worker wakes on Postgres `NOTIFY` (delivered on commit, so never before the job is visible) rather than Valkey pub/sub (fires before the commit, lost when nobody listens). The client is the Redis-protocol `redis` crate and the setting is `REDIS_URL` (a `redis://` or `rediss://` URL, as ElastiCache gives). Production (P1): ElastiCache for Valkey in the VPC. Intended next users, through the same small `runflow-kv` crate: notifications (fan-out, unread counters, presence). Replaces D-009's original "no Redis" | Founder: offload the database's hot paths; a flexible cache; one-time codes for sure; Valkey rather than Redis | Accepted (founder) |
| D-048 | **Semantic versioning (founder, 2026-11-03):** every push to main is a release. CI computes the version from the conventional commits since the last `v*` tag (`.github/scripts/next-version.sh`: breaking → major, minor while 0.x; `feat` → minor; anything else → patch; the first tag is v0.2.0), bakes it into the API (`/v1/health` and the Sentry release show `0.2.0+<sha>`), tags the images `:v<version>`, then tags the commit and publishes a GitHub release with generated notes. 1.0.0 comes with the public launch | Founder request | Accepted (founder) |
| D-049 | **Activity matching (founder, 2026-11-04; R3).** Activities (Strava or logged) are matched to planned workouts automatically, by day and size rather than by the planned date alone: a workout done a day or two early or late, cut short, or swapped with another day is found, linked and marked done (completed at ≥ 80%, else partial). When two workouts are about equally likely, the engine asks the student ("Qual treino foi esta atividade?", the options + "Nenhum destes"); a student's choice is never overridden. Questions only for the last 7 days. A workout completed by the engine waits for the student's PSE and comment; the trainer is notified on the student's first report, not on the match. One pure engine with golden examples (`api/activity-match-examples.json`) in the mock and the backend; rules and thresholds in `docs/activity-matching.md`. Consent (D-011): an activity only completes workouts of clubs the student shares it with (training data, plus Strava for a Strava activity); staff see a synced activity only with that provider shared; turning sharing off asks first and shows on the club's dashboard (`sharing_off`, 14 days) | Founder: people move workouts between days; match the training actually done, auto-mark it done, ask only when in real doubt (rare). Thresholds are an engineering proposal tuned by the examples | Accepted (founder intent) |
| D-051 | **QA's data is kept; schema changes are real migrations (founder, 2026-11-04).** Testers use QA with real accounts now, so it is never wiped again by a change. `backend/migrations/0001_bootstrap.sql` is frozen as applied; every schema change is a new `migrations/NNNN_name.sql` (`backend/scripts/new-migration.sh`), written expand-then-contract, in the same commit as the change to `api/schema.sql` (still the full current schema; `db/tests/contract.rs` proves all migrations together build it exactly). `scripts/applied-migrations.sha384` records every shipped migration and `check.sh` fails when one changes or a new one isn't recorded (`scripts/freeze-migrations.sh`). `ops/qa/update.sh` no longer resets QA: an edited migration keeps the API down and logs it, the data untouched; `reset-db.sh` stays a manual tool. QA is backed up nightly on the NUC (`ops/qa/backup.sh`, 14 days; founder, 2026-11-04). Also: every bug fix lands with a test that fails without it | Founder: "this will be a pattern from now on (and we avoid deleting the db, so from now on, actual real migrations will be needed)" | Accepted (founder) |
| D-052 | **Aulas come back, and the app shows only what the club's modalities use (founder, 2026-11-04; G1–G5).** Class scheduling returns (venues, class types, recurring schedules, sessions, bookings with waitlist, QR check-in, attendance report), this time in the contract, a migration, the backend, the web app and the phone app. Every feature belongs to modalities, and every role (owners and trainers too) sees only the features of the modalities the club has; the owner turns modalities on and off where they do today (Configurações). Feature → modalities: **Aulas** Funcional, Musculação or Natação; **Exercícios** Funcional or Musculação; **Provas**, **Strava / Relógios e apps / Atividades / activity matching**, **zones and their tests** Corrida, Natação or Ciclismo; sports in builders and filters: the club's own; everything else (planning, library, planilhas, students, feedbacks, messages, mural, reports) always. One table per app (`features.ts`), so a change is one line. Supersedes D-035 for Aulas | Founder: "add the gym function again… the app should be smart not to get cluttered… even for owners and trainers only show the features enabled". The modality ↔ feature table is an engineering proposal | Accepted (founder intent) |
| D-053 | **Production is one AWS EC2 instance running the compose (founder, 2026-11-05; replaces D-040).** The same images and compose as QA: API + worker, PostgreSQL 18 and Valkey on the instance (data on its disk, backups off the box), the web container behind a Cloudflare Tunnel and the edge cache, self-hosted Umami (D-054); uploads in S3 (founder: "maybe", settled in P1; Garage otherwise). Metrics and logs go to **Grafana Cloud**'s free tier (only Alloy on the box; the dashboards are code and import there), errors to Sentry. No RDS, Aurora or ElastiCache until revenue pays for them. Free tier first; growing means a paid AWS account with the same setup, then a bigger instance or Kubernetes, self-hosting more as needed. The Lambda work planned for P1 is dropped | Founder: "prod will be ec2 container… rds and elasticache would be too expensive… if ever we scale, moving into a paid aws account would be fine… we can then move from ec2 to k8s and self host things as needed" | Accepted (founder) |
| D-054 | **Product analytics (founder, 2026-11-05).** (1) **Umami, self-hosted** (cookieless, no consent banner) in the same compose, its data in its own `umami` database on our Postgres, in Brazil (Umami Cloud has no São Paulo region, so it was dropped). The tracker is first-party: the web container's Caddy forwards only `/insights/script.js` and `/insights/api/send` to Umami; the app sends page views itself with token-like path segments masked and only `utm_*`, `ref` and `perfil` kept from the query; the API hands out `UMAMI_WEBSITE_ID` in `/public/config`. Its dashboard has its own host and login (`analytics-qa.runflow.club`; production `analytics.runflow.club`). (2) A Grafana **Product** dashboard from Runflow's database through `grafana_reader`, a read-only role with column-level grants (ids, dates, roles, statuses, club names; no personal data): the activation funnel, each club's progress, weekly activity. Events from the phone app come later | Founder: "umami cloud does not have anything in sao paulo - lets self host it" | Accepted (founder) |
| D-055 | **The completed-training analysis (founder, 2026-11-05).** What Strava's detailed activity carries is kept, not just totals: device laps with their pauses and position (a "tiro" and its recovery are separate laps), Strava's per-km splits, the full-resolution route, and the time series (heart rate, distance, altitude, speed, position) sampled to ≤ 600 points in `activity_streams`. Every activity is fetched in detail (webhook, or one by one after a connection's import), its series by a separate job; `runflow strava-refetch --days N` refetches older ones. The detail views (activity, the student's completed workout, the trainer's workout) show one "Parciais" table first: the watch's laps when they say more than the per-km splits (a "tiros" session, laps pressed by hand), else the splits; the same columns either way (distance, time, pace, average FC), the tiros found by rule (two pace groups at least 12% apart, two laps or more each) and highlighted (founder, 2026-11-06); then the route on a map: MapLibre over OpenFreeMap's tiles (free, no key or limits, OSM credit under the map; the app shows the same page in a web view, so it runs in Expo Go), with the plain drawing as the fallback offline or without WebGL; no paid Google Maps (founder, 2026-11-06); then heart rate over time, with the tiros shaded. Once an activity completed a workout, the plan above folds to its intensity profile and the activity, feedback and button share one compact card, so the table starts on the first phone screen (founder, 2026-11-05). Each new activity from the webhook notifies its athlete (`activity_synced`, push on by default, switchable in Notificações) | Founder: "the 1km timing view or per tiro is absolutely necessary, also FC is nice (and the most important view on the concluído treino)… record [the map data] for when doing later… everytime a training is synced we should send the user who trained a notification (which should also be toggleable)" | Accepted (founder) |
| D-056 | **Account activity is kept for a future inactivity policy (founder, 2026-11-06).** People, their club memberships and clubs carry `last_active_at`; people also `last_sign_in_at` and `last_sign_in_attempt_at` (asking for a code counts, even unused). Kept by the day, never per request (founder: buckets like today / last month / last year / older are enough; sessions slide for 60 days, so active people never sign in again and sign-ins alone can't tell): a person's row is written on the first session use of each day, a membership on its first club request of the day (an in-memory set per API process decides: no Valkey or database work on other requests; the write is off the request path), a club once a day whatever its size; no indexes on these columns, so each stamp is a cheap HOT update (a daily scan suffices). Back-filled from sessions in migration 0004. No warnings, no deletion yet: the policy (who is inactive, the e-mails, what cascades) is decided later from this data | Founder: "we need to have the pipes to be able to delete in the future… a way to tell if a user or org is active… we just need to have the data in the db so we can decide later on how we will want to cascade delete" | Accepted (founder) |
| D-057 | **Pushes are signed by the club (founder, 2026-11-07).** A push's title is the club's name, its body the notice's own title and text, its picture the club's logo (Expo `richContent.image`, shown by Android as is; iOS needs a Notification Service Extension, later; the web push's icon). An account-wide notice (a Strava sync) is signed by the person's only active club, else sent as is. Not possible per message, so not done: the notification's color and small icon, and the app name Android shows above it (one app for all clubs, D-018) | Founder: "is there a way for the notification to be more customized for the org? e.g. the logo… the goal is always for the user to feel like they are using their club app and not runflow per se" | Accepted (founder) |
| D-058 | **Targets as the coach wrote them; profiles that show the session's shape (founder, 2026-11-07).** A single pace, heart rate or power is exact (`@4:50` is 4:50, not 4:45–4:55); ranges only when written (`4:20-4:30`). A run rep under 1 km shows its time first ("54″ (4:30 /km)"). The watch export widens an exact value by ±5 (watches alert on a range). The intensity profile keeps colors by zone but its heights blend the absolute scale (how fast or hard) with the session's own min/max, so a progression 4:50 → 4:20 climbs and a fartlek's changes show | Founder: "I actually defined 4:50 without variation and I would like that to be shown to the student… each tiro in 54″ not 52-56… less is more"; "the bars height should be based on a combination of max/min of that session and max/min as current" | Accepted (founder) |
| D-024 | Public pages are **always Runflow's brand** (landing, sign-in, invite page, club picker, club creation); the club's colors apply only inside the signed-in app (web and mobile) | Founder: the marketing site and sign-in are ours | Accepted (founder, 2026-11-02); e-mails changed by D-036 |
| D-016 | Payments via Stripe; no charging during the beta; NFS-e handled by the founder outside the product | Founder decision | Accepted (founder) |
| D-017 | Trainers see all students in their club | Simple default; per-trainer assignment can come later if clubs ask | Accepted (founder) |
| D-019 | Club themes: the DB stores the owner's choices plus the theme derived at save time. Web inlines it in the HTML; mobile caches it on the device; both revalidate by `rev`/ETag (§7.8) | The first paint is already in the club's colors; one engine run per save, not per request | Proposed |
| D-018 | Runflow is the app; clubs theme it. No white-label apps, no club-branded store apps or PWAs, no "feito com Runflow" marks | Runflow is the product, just flexible in how it displays | Accepted (founder) |

"Proposed" means the default we build on unless the founder objects. A Proposed entry flips to Accepted when the founder confirms it or when the first implementation ships.

---

## 10. Roadmap and session plan

**Phases**
| Phase | Goal | Status |
|---|---|---|
| **0: Design system** | Tokens, club-theme engine, foundations page | **Done.** D1 approved by the founder (2026-11-01) |
| **1: Web app on the mock API** | Every screen, wired to the mock: auth, onboarding, coaching loop, library, planilhas, classes, Club Studio, billing (Stripe mock), account | **Done** (F0–F32) |
| **2: Real backend** | Rust API on PostgreSQL implementing the whole contract; Docker Compose; Pi deployment (D-025); founder priorities of 2026-11-02 (logo, week release, notification control, smoke tests, observability) | Done through S7b (the whole contract, billing, push). **Next:** the mobile app (Phase 3) and R1 text parser, in parallel; everything for production (P1) in its own session later (`docs/build-plan.md`) |
| **3: Mobile app** | Expo app at feature parity with the web app, on the real API (parity checklist in `docs/build-plan.md`) | **Parity done** (X0–X15, 2026-11-03). Next: X16 native extras (Google sign-in, widget, Health) on a development build, after the founder's Expo/Google setup |
| **4: Private beta** | Friendly running clubs; Strava app review; LGPD texts | — |
| **5: Public launch** | Stripe live (Pro), production on AWS EC2 (D-053, from P1) | — |
| **6: Growth** | Garmin, Sign in with Apple + iOS App Store, club finances, class scheduling, events, challenges, AI assistant, Apple Health / Health Connect, Max, Enterprise | — |

**Next step:** the first unchecked row in `docs/build-plan.md`. Each step ends with its box ticked, the checks green, and a commit pushed.

**Session log**
- 2026-11-01. S0: `root.md` created. Researched sisrun pricing and features, the Strava API Agreement (2026-06-01), and the Garmin developer program. A prototype of the club-theme color engine exists and will seed S1.
- 2026-11-01. Founder set the provider sync model (D-011): students connect their own accounts and activities sync into Runflow's training model for trainers. A re-read of Strava's agreement confirmed that sharing needs explicit consent. Ran `git init` on the root.
- 2026-11-01. Founder created a single repo, `github.com/otaviojacobi/runflow-future`, for all code, with areas splittable into repos later (D-001 replaces the submodule plan). Added the rule against AI attribution in commits (§8). First commit pushed.
- 2026-11-01. **D1 delivered, in founder review.** `design/` has the tokens, the color engine, `build.mjs --check`, self-hosted fonts, CI, and the foundations page in pt-BR (`node design/serve.mjs`, then http://localhost:8080). Founder decisions made during the review: everything user-facing is pt-BR, including the design system and all error messages (D-013); clubs can set 0, 1 or 2 colors (D-014); club themes are stored in the DB and delivered without a flash of Runflow colors (D-019, §7.8).
- 2026-11-01. **Founder approved the design system (D1).** New approach (D-020): contract first (`api/schema.sql` validated on PostgreSQL 18, `api/endpoints.md`), then the real web app on a mock API screen by screen, then mobile, then the Rust backend. Plan and status: `docs/build-plan.md`. The founder authorized committing and pushing after each step.
- 2026-11-02. **Phase 1 (web app on the mock API) complete: F0–F30 and F20 hardening.** Beyond the core screens it covers classes, races, messages and mural, assessments, challenges, reports, club finances, an assistant (provider-agnostic contract, rules engine in the mock; open question §11.4), the exercise library, imports/exports (CSV, .FIT, .ics), command palette and an installable PWA. Contract: 55 tables in `api/schema.sql`. Quality gates: `npm run check` (incl. a 200 KB initial-JS budget) and `npm run e2e` (flows, axe WCAG AA, 360 px layouts) in CI. Design change: `fg.subtle` now meets 4.5:1 (new neutral steps 450/550) because it carries meta text. Next: Phase 2 (mobile, X0).
- 2026-11-02. Founder decisions: personal e-mail invites, 7 days, single use, bound to the invited e-mail (D-023, replaces the shareable link/QR/WhatsApp invites of §4.5); public pages always in Runflow's brand (D-024). Mobile X0 scaffold delivered (D-021, D-022).
- 2026-11-02. Founder decisions: backend before mobile (D-025: Phase 2 is now the Rust backend, mobile is Phase 3 on the real API); e-mail via Resend (D-026); workout hashtags first-class (F32); `.xlsx`/`.xls` import recorded as a later TODO (CSV covers it now). The invite form now sends one person at a time.
- 2026-11-02. **S1 backend bootstrap.** Cargo workspace (`runflow` binary + `api`, `db`, `integrations`), `/v1/health`, pt-BR problem+json, config from env with every variable in `.env.example` (local `.env` git-ignored), migrations starting from `api/schema.sql` with a test proving they build the same database, Resend e-mail with a log fallback (D-026) and a token-based layout, Dockerfile, root `docker-compose.yaml` (Postgres 18 :5433 + API :3000), backend CI. `npm run check` now covers the backend.
- 2026-11-02. **S2 auth.** E-mail codes through Resend (HMAC-hashed, bound to the address, rate-limited), Google ID tokens verified against Google's keys (no client secret needed), opaque SHA-256-hashed sessions as Bearer or HttpOnly cookie, the `/me` family (profile, LGPD delete and export, prefs, consents, notifications, sessions). Queries are compile-time checked (`sqlx::query!`, offline data committed). The mock now anonymizes deleted accounts and restricts `avatar_url` like the backend. New step S9: switch the web app to the real backend.
- 2026-11-02. Founder decision: no club-fee payments in v1 (D-027). F26 (club finances) removed from the web app, mock, contract and schema (F33; backend migration `0002` drops its tables) and moved to the later list.
- 2026-11-02. **S3 clubs, branding, invites, members.** Rust color engine reproduces the design fixtures byte for byte (fixtures now include the stored theme and CSS); the starter library became a contract artifact (`api/starter-library.json`); uploads through `object_store` (disk now, S3 later) with type sniffing and a sandboxing CSP; the Postgres job queue and `worker` (in-process with `all`) send invite e-mails with retries; members, groups and leaving match the mock. Founder's hosting options recorded in `docs/hosting.md`.
- 2026-11-02. **S4 coaching core.** Typed workout structures (every seed structure validates), template and exercise libraries (global catalog as a contract artifact), planned workouts and planilhas, the student side with personal zone targets and auto-matched completions, threads and the feedback inbox, the `.ics` feed, athlete summaries/detail/profiles/zones, and the dashboard. Docker Desktop kept stopping on the dev machine, so the session used the native Docker engine (`DOCKER_CONTEXT=default`).
- 2026-11-02. **S5 Strava.** OAuth (signed state, encrypted tokens), background sync and webhooks via the job queue, refresh, deauthorization and disconnect per §5, own activities; all tested against a fake Strava server.
- 2026-11-02. **QA on the Pi** (D-028): `setup-todo.md` is the founder's setup guide; images build on every push; `ops/qa/` runs Postgres, API + worker, web (Caddy) and the Cloudflare tunnel. Club subdomains need the web shell (S9); in QA they are `<club>-qa.runflow.club` (D-029).
- 2026-11-03. Founder picked the logo **Ritmo** (D-038), applied to the app, favicon, PWA and mobile icons, e-mails and the design showcase (B1b). Also landed since 2026-11-02: F35 notification control, F36 feedback round, F37 (Aulas and Desafios removed; one bootstrap migration), S14 club-colored e-mails, S15 Garage storage, S9a web app on the real backend.
- 2026-11-02. **QA live** at qa.runflow.club (API ~1 ms on the Pi, ~30 ms through the tunnel; the web app from Cloudflare's edge, S8b). Founder priorities: logo redo (B1: concepts on `/dev/logo`, B1b applies the pick), week release (D-031, F34), notification control (D-032, F35), smoke tests on deployed environments (D-034, S11), observability with Sentry + Prometheus/Loki/Grafana (D-033, S12–S13), and data disposable until the beta (D-030). `setup-todo.md` now lists only the open setup steps; the full QA guide moved to `docs/ops/qa-pi.md`.
- 2026-11-03. **S6c on the backend:** races and entries (goal race drives the profile goal and date, finished runs the recent race), assessments with zones and profile fields from applied tests, the training report (SQL aggregates), and the assistant as a Rust port of the mock's rules engine (`source: "rules"`, no student data leaves the server; the LLM choice stays open in §11). Formulas and parser outputs are tested against the mock's answers.
- 2026-11-03. **S7 billing on the backend:** Stripe Checkout and Billing Portal, signed webhooks stored once and applied by the worker. Without Stripe keys the billing simulation (`BILLING_SIMULATION`, on in dev and QA) serves the app's `/dev/stripe` pages, like the mock; with neither, upgrades answer `503 billing.unavailable` (D-016: no charging in the beta). Push moved to S7b.
- 2026-11-03. **S7b push:** the installed web app turns on notifications per device (Perfil → Notificações); the API encrypts each push for the browser (RFC 8291, checked against the RFC's example) and signs it with VAPID (`runflow vapid-keys`). Delivery follows F35: per-kind `push`, pause, quiet hours (held until they end, dropped if read first); only known push services are accepted as endpoints; dead subscriptions are forgotten. Expo push joins with X10.
- 2026-11-03. Founder: QA is disposable (D-039: no backups or drills, the backup timer removed; S8 closed); production target is Lambda + Cloudflare Pages + Aurora + Grafana Cloud + Sentry + Stripe + Resend, set up in its own session (D-040, P1), with the code kept pluggable meanwhile. Work now runs in parallel (agents on separate tracks). New R1: excellent free-text workout parsing with rules, one parser for the builder and the assistant, the founder adds examples.
- 2026-11-03. **S12 Sentry:** backend and web report errors with the user id only (scrubbed URLs, no headers, cookies, bodies or queries); off until the founder sets `SENTRY_DSN` / `SENTRY_WEB_DSN`. The web SDK loads lazily and only when the API turns it on.
- 2026-11-03. **S13 telemetry:** traces, metrics (requests by route, jobs, backlog, DB pool) and logs pushed over OTLP, off until the Grafana Cloud stack exists. Founder: skip S16 (Lambda work moves into P1) and go to the app (Phase 3).
- 2026-11-03. **QA observability (D-041):** Grafana, Loki, Prometheus and Alloy on the Pi (logs of every container, API metrics, Pi host metrics, a provisioned dashboard) at `grafana-qa.runflow.club`; Grafana Cloud stays for production. Sentry projects per environment come through the Sentry plugin.
- 2026-11-03. Sentry projects created (org `runflow-zw`): backend and frontend for QA and production; QA reports errors now, production keys wait for P1.
- 2026-11-03. **R1 free-text workouts:** one rules grammar for coaching shorthand and plain pt-BR sentences (repeats and series, recoveries, paces and rep times, zones and intensity words, RPE, heart rate, power/FTP, progressions, swim strokes/equipment/send-offs, strength sets × reps × load), ported identically to the web builder (TS), the mock and the backend (Rust); 171 golden examples in `api/workout-text-examples.json` checked by all three (plus a random corpus for the backend). What isn't understood becomes a warning; `/ai/workout` now returns `warnings` and `tags`. Grammar and known gaps: `docs/workout-text.md`; how the founder adds examples: `api/CLAUDE.md`.
- 2026-11-03. Founder: club sites/custom domains removed entirely (D-042, F38); plan wording "Todos os recursos do plano Free/Pro". R1 merged; mobile X1–X3 merged, X4/X4b/X7/X8 running in parallel.
- 2026-11-03. Session paused by the founder. Queued: B2 plans v2 (seats per role), B3 Stripe for real on QA, B4 club freezing for unpaid subscriptions. Mobile X4, X4b, X7, X8 paused mid-work on local branches (`docs/build-plan.md`).
- 2026-11-03. Founder queued N1 (notifications push only, a simple on/off per kind; no notification e-mails) and F39 (remove calendar sync).
- 2026-11-03. **F39:** calendar sync removed (D-045): the `.ics` feed, its `calendar_feeds` table and the C1 "Agenda no celular" card are gone from the contract, the mock, the backend and the web app.
- 2026-11-03. **N1 push-only notifications (D-045):** every notification lands in the app; `/me/prefs` is just `{kinds: {<kind>: {push}}, paused}` (push on by default except staff feedback and new members). The notification e-mails (instant and the daily "resumo"), the per-kind app switch, quiet hours and the staff group filter are gone from the contract, the mock, the backend (the worker's e-mail digest work) and C1, which is now a list of switches plus "Pausar tudo".
- 2026-11-03. **B2–B4 plans by seats, real Stripe, frozen clubs (D-043):** Free 1+1+10, Pro 1+2+30 (R$ 19,90), Max 1+5+100 (R$ 79,90 + R$ 5 per extra trainer + R$ 0,50 per extra student), one catalog (`api/plans.json`, `GET /public/plans`) for the mock, backend and apps. Seat limits on invites and member changes, one owner per club, Pro ⇄ Max. Stripe in test mode on QA: prices by lookup key, `runflow stripe-setup`, Max seat quantities synced by the worker. A failed payment leaves 7 days, then staff get the icy frozen layer (writes answer 423) and the way out to payment; students never notice. QA images amd64 only (S8d); Grafana in English (internal tools are English, D-013).
- 2026-11-03. **R2 workout text engine v2** from the founder's real workouts: sets over several lines with `Desc. A & B`, named blocks with a total (any words, no list of names), alternating pairs, rep times, ranges (`15-20x`, `60-80m`), trailing easy lines as the cool-down; intensity words are now PSE with the word as label, never zones (contract: `rpe.label`, `max_count`, `max_s`/`max_m`, repeat `note`); 184 golden examples in all three ports (`docs/workout-text.md`).
- 2026-11-03. **S17 Valkey (D-047):** sign-in codes and their limits, the assistant's rate limit, a 60 s session lookup cache and the cached dashboard and report moved to Valkey (`runflow-kv`; `REDIS_URL`; compose, QA and CI run `valkey/valkey:8.1.11-alpine` without persistence; tests on a real Valkey). D-009 updated: jobs stay on Postgres. The job queue stays in Postgres; the worker now wakes on `NOTIFY` instead of polling every second. No API changes.
- 2026-11-03. **Phase 3, the app at parity with the web (X4–X15).** A parity checklist maps every web screen to a mobile step (`docs/build-plan.md`). The four paused branches (X4 student Hoje/treino/agenda with the week offline, X4b messages and mural, X7 account and push switches, X8 trainer) were rebased onto the day's contract and finished; then X5 (activities, Strava connected in the app), X9 (student welcome, create a club), X10 (phone push: register/forget, a tapped push opens in its club; the push payload gained `club_id`), X11 (races), X12 (library and builder; the app's copy of the quick-text grammar passes the 184 golden examples in `npm run check`), X13 (planilhas), X14 (assessments, reports with CSV/PDF, exercises) and X15 (Club Studio, members, settings, billing and the frozen layer for staff, D-043). Built as parallel agents in worktrees, merged one by one with checks green. Phone push needs a development build and the founder's Expo, Apple and Firebase setup (`docs/ops/push-notifications.md`); X16 holds the native extras beyond the web (Google sign-in, widget, Health). Planilha phases were only ever in the feature map, so they're a later item.
- 2026-11-04. **R3 activity matching (D-049).** The intent always said activities are matched to the plan automatically; the code only matched when the student tapped "Concluir", on the same day. Now an engine (mock and backend, 19 golden examples) links each activity to the likeliest workout within 2 days by day and size, completes it, and asks the student only when two workouts are about equally likely (`GET /me/activities?match=pending`, `PUT /me/activities/{id}/match`). Contract: `activities.match_state`, `activity_match_options`, `workout_completions.matched_by` and `reported_at`, one activity per workout. The release APK's crash (no `Intl.PluralRules` in Hermes) was fixed the day before; the QA APK is now built for arm64 only (115 MB → about 40 MB).
- 2026-11-04. **Real migrations from now on (D-051):** QA's data is kept; the bootstrap migration is frozen as QA applied it (checksums recorded, `check.sh` refuses edits), new changes are `NNNN_*.sql`, and QA's updater no longer wipes the database. The same day: Strava sharing required to connect (D-011), Strava brand guidelines, coach/athlete sign-in, Google sign-in in the app, phone push through Firebase, push defaults per kind, unread counts on Mensagens and Feedbacks, dd/mm/aaaa dates, the black Android navigation bar.
- 2026-11-05. **S13c one Grafana dashboard per service:** API, Worker, Postgres, Valkey, Garage, Web, Tunnel, Host and containers, next to the overview (now with a service health row), generated by `ops/qa/observability/grafana/dashboards.mjs` and checked by `npm run check:ops`. Alloy now scrapes every service and reads per-container usage (cAdvisor). Founder's leaning for the first production: a free-tier EC2 running QA's compose (`docs/next-steps.md` §2, not yet a decision); product analytics options in §7.
- 2026-11-05. **Production and analytics decided (D-053, D-054).** Production is one EC2 instance running the compose, with Grafana Cloud and no managed databases until revenue (replaces D-040's Lambda/Aurora). Analytics: Umami self-hosted on QA (Umami Cloud has no São Paulo region) with a first-party tracker through Caddy and masked page views, plus a Grafana **Product** dashboard (activation funnel, clubs, weekly activity) from the database through a read-only role with column grants (S13d).
- 2026-11-05. **R4 completed-training analysis (D-055).** Felipe's 7.5 km synced but its view was thin: only totals and laps bars. Now Strava's per-km splits, full laps with pauses, the full route and the sampled heart-rate/pace/position series are stored (migration 0003, `activity_streams`), and the activity, completed-workout and trainer views show heart rate over time (tiros shaded), splits or named tiros, and the route, on the web and the app. New activities notify their athlete (`activity_synced`).
- 2026-11-06. **R5 account activity (D-056).** `last_active_at` on users, memberships and clubs, plus sign-ins and sign-in attempts, kept with throttled writes for a later inactivity policy; nothing deletes or warns yet. Same day: one Parciais table, the route on a MapLibre + OpenFreeMap map, pull to refresh clears a stale "Sem internet".
- 2026-11-07. **Pushes signed by the club (D-057):** the club's name as the title and its logo as the picture. Notification settings lose their explanations; Grafana hides the healthcheck's `/v1/health` unless switched on; `npm run apk:local` builds the QA APK on this computer.
- 2026-11-07. **Real workouts from a club (R1 grammar):** `|`, `p:`/`P:` pauses, `3x-600m` sets over lines, `A : B` alternations and totals with a pair (`4.5km - 3' (4:35/km) : 5' (4:18/km)`), in the mock, web/app and backend parsers (189 golden examples). Targets exact as written and profile heights by the session's shape (D-058).
- 2026-11-01. Founder decisions: design-first Phase 0 with the full UI mocked before implementation (D-015); Stripe, no charging during the beta, NFS-e outside the product (D-016); trainers see all students (D-017); Runflow is the app and clubs only theme it (D-018); Apple and Garmin developer programs deferred (D-007, D-011); no guardian accounts. Added the screen inventory (§6.1) and `CLAUDE.md`. Roadmap renumbered: Phase 0 is now design and validation, and **D1 is next**.

---

## 11. Open questions and deferred items

**Open**
0. **First production on free tiers** (founder, 2026-11-03; host decided 2026-11-05, D-053: one AWS EC2 instance running the compose): still open are uploads (S3 or Garage), backups off the box, the domain layout and the free tier's limits (P1). Earlier options: Oracle Always Free in São Paulo, the NUC, or AWS EC2, web on Cloudflare Pages, uploads and backups in R2, Grafana Cloud, Sentry; plus tracking, SEO, marketing and the LGPD texts. Options, costs and a proposed order: [`docs/next-steps.md`](docs/next-steps.md).
1. **Strava written confirmation.** In Strava's app review, describe the coaching use case (students consent to share with their club's trainers) and keep the reply on file. Do this before inviting real clubs.
2. **Brand.** Palette and type approved in D1; logo "Ritmo" chosen (D-038, 2026-11-03) and applied everywhere (B1b).
3. **AI provider and budget (F27).** The assistant runs on deterministic rules in the mock and the backend (`source: "rules"`, no student data leaves the server). Founder (2026-11-03): make free-text parsing excellent with rules first (R1 done: one grammar in the web builder, the mock and the backend, golden examples in `api/workout-text-examples.json` that the founder keeps adding to, `docs/workout-text.md`); an LLM may plug in later behind the same contract, with a per-club monthly cap per plan and only the club's own data (LGPD: never health notes without consent).

**Deferred by the founder (2026-11-01)**
- Apple Developer Program: blocks Sign in with Apple and the iOS App Store release.
- Garmin Connect Developer Program: blocks Garmin sync and send-to-watch. It costs nothing, but needs an application and approval.
- Charging customers: Stripe goes live in Phase 5. NFS-e stays outside the product.
- Guardian accounts for minors: not planned.
- Club fees through Runflow (D-027): removed from v1; decide Runflow's take rate before bringing it back (§4.6).
- `.xlsx` / `.xls` import (students, workouts): CSV upload and paste from Excel / Google Sheets cover it for now (`docs/build-plan.md` § Later).

---

## Appendix A: original founder brief (verbatim, 2026-11-01)

> This is the root repo for a new project: runflow (I bought the domain already: runflow.club). Runflow will be a claude/agentic created project e.g. we should be able to derive intent and general development guides from the repo itself. We will start by drawing the system to which you will be able to incrementally (respecting max token usage) create the whole system, the basis will be: product, design & engeneering. The product: runflow is a training system focused on the Brazillian market (so main language displayed is PORTUGUESE, hosting will be in São Paulo). Runflow connects trainers/clubs with its trainees/students. Our concurrent is sisrun (https://sisrun.com.br/) our main differentiators: we support training clubs but also other modalities such as gyms (scheduling), swimming clubs, and hybrids (mix). We will offer (even for free subscriptions) a "club studio" where the user can customize logo and colors so that the webapp and mobile app look like with their club, for paid subscriptions we will also provide a subdomain hosting e.g. myclub.runflow.club. Product side: the main focus is the usability for trainer to be able to add new trains, and main usability for end customer that also has sync with Strava and Garmin initially (but extensible in the future for apple watch etc, for now Strava and Garmin). Initially, we will have Free tier: upt to 10 users (all features, good marketing around generous free tier). Pro plan: up to 100 users, all features, custom subdomain (20R$/month). Max: TBD. Probably something like 100R$, and then some kind of per-customer charging/month (but very small), enterprise: self hosted (but this is a small thing). The architecture: the backend will be rust (axum/tokio). The database will be postgres (sqlx) with some proper hosting for logos images etc, frontend we can use the basic that works - up to you to decide, possibly react? Altough I am open to other ideas if need be. App development I need something that works for android and ios and is fast (sisrun is slow). we will need self hosting capabilities. Initially, I will run the whole thing on my self hosted rapsberrypi but if product works, I will migrate to some cloud provider (aurora+even lambdas on aws should be fine because we are on rust and everything kind of translates easily enough) and on the Pi I can self-host everything until things grow and I need proper replication etc. Create the now the documents, and very important we will need a design system - our frontend must have defined components, colors, fonts etc and a small dummy page where we can see the main colors: we will need a very good design for both web and mobile and that things are coherent. We will need well though onboard flows and proper auth (google and apple signin) also roles that are Owner vs Trainer vs Student. More over, our main advantages over our competitors will be: UX. Our UIs, workflows, will be better, we will allow you to create trainings more easily. PRICING we are simply cheaper, because we will run in a more modern architecture leveragiing agentic coding for scaling things. SPEED: sisrun is always crashing and slow. We will do it differently. With all this create the main root.md file where the description for everything starts and where we define the basis to start iterating for the creationg of this company/project.
>
> *Follow-up (same day):* For now, just the root.md, so the initial request can be worked on across different sessions. From there we will create different repos (runflow-backend, runflow-design, runflow-frontend, runflow-mobile) where frontend and mobile consume from the design one (which should be small).
>
> *Follow-up 2 (same day):* "I created a single repo which for now will hold all the code (If in the future I need actual sub-repos that should also be easy to do […]) here is the URL https://github.com/otaviojacobi/runflow-future.git. Also make sure to never add yourself as contributor"
>
> *Follow-up 3 (same day):* "Let's add a CLAUDE.md file too. We can start with the design system and overall mocked UI we would want to support (not sure what is the best project but we would want to go a bit waterfall here and mock so that I can validate that everything looks good before actually going to the implementation). We will use Stripe for payments. We are not charging yet, I will deal with NFS-e. Trainer should have visibility over all students initially. I will not pay for the apple/garmin connect developers for now. No need for minors/guardian accounts. No need for "feito com Runflow" this is not an app where you make your app - this is the app, it is just flexible for diplaying"
