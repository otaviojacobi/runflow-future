# Next steps: from staging to the first real users

Written 2026-11-03, after the mobile app reached parity with the web (X0–X15). This is a thinking document: options,
trade-offs and a proposed order, for the founder to decide on. Nothing here is decided until it lands in `root.md` §9.

**The constraint (founder, 2026-11-03):** spend nothing beyond what's paid today (Strava, the Claude Max subscription,
the domain). Free tiers only until real customers pay; then spend where it buys reliability.

---

## 1. Where we are

- **Product:** web app (all screens), Rust API + worker, mobile app at parity with the web. Free-text workouts in four
  matching ports. Plans by seats, Stripe in test mode, push (web; phone push needs the Firebase/Expo setup).
- **QA:** https://qa.runflow.club on the Intel NUC at home, behind a Cloudflare Tunnel, deployed on every push,
  disposable (wiped whenever the schema changes, D-030/D-039). Self-hosted Grafana/Loki/Prometheus, Sentry, and the
  pgweb database viewer on the LAN.
- **Mobile:** APKs built on Expo's servers (`npm run apk`, project `@otaviorunflows-team/runflow`).
- **Next for the founder:** the full manual test round (`docs/ops/full-manual-test-round.md`). If it passes, we switch
  from "wipe anything" to incremental changes on data we keep (§4).

---

## 2. Production: options on free tiers

What production needs: the API + worker (one Rust binary, ~50 MB RAM idle), PostgreSQL 18, Valkey (cache, can vanish),
object storage for logos and avatars, e-mail, the web app (static files), TLS, backups, logs, metrics, errors.

### The free building blocks (worth using whatever runs the API)
| Need | Free option | Free allowance (verify before relying on it) |
|---|---|---|
| Web app + landing | **Cloudflare Pages** | Static hosting with no bandwidth cap; 500 builds/month |
| TLS, DNS, no open ports | **Cloudflare Tunnel** (already used by QA) | Free; the server needs no public IP |
| Uploads (logos, avatars) | **Cloudflare R2** (S3-compatible; our `STORAGE_BACKEND=s3` works as is) | 10 GB-month, 1M writes, 10M reads/month, **no egress fees** |
| Backups (off-site) | **R2** again | Same allowance; a small club base fits in GBs |
| Metrics, logs, traces | **Grafana Cloud** free (D-040; code already pushes OTLP) | ~10k active series, 50 GB logs, 50 GB traces/month, ~14-day retention |
| Errors | **Sentry** Developer plan (projects already exist) | ~5k errors/month, 1 user |
| E-mail | **Resend** free (D-026) | 3,000/month, 100/day: enough while only codes, invites and account e-mails go out (D-045) |
| Phone push | **Expo push + Firebase Cloud Messaging** | Free (iOS needs the Apple Developer account, US$ 99/year, later) |
| App builds | **EAS** free | 15 Android + 15 iOS builds/month, low-priority queue (can exceed 90 min at peaks) |
| Payments | **Stripe** | No monthly fee; per-transaction fees only once charging (Phase 5) |

### Where the API, Postgres and Valkey run
| Option | Monthly cost | Good | Risks / costs |
|---|---|---|---|
| **A. Oracle Cloud Always Free** (Ampere A1 ARM VM, region São Paulo `sa-saopaulo-1`): the same compose as QA, behind the tunnel | **$0** | Real cloud VM in Brazil (data residency, ~10 ms to users), generous RAM, block storage included, ARM (we already build arm64 images on native runners) | **Capacity**: new A1 instances often fail with "out of capacity" (retry or another region). **Idle reclaim**: Oracle stops "idle" Always Free VMs (CPU ~<20% at the 95th percentile over 7 days); upgrading the account to Pay As You Go (still $0 within the free limits) is the official way to avoid it. A 2026 report says the A1 allowance was halved (2 OCPU / 12 GB), unconfirmed; still plenty. Home region can't be changed later. |
| **B. The NUC at home as production** (QA moves to a second compose project on the same NUC, or to the dev machine) | **$0** | Everything already runs there; fastest to ship; plenty of CPU/RAM/SSD | Home power and internet are the uptime (a UPS, ~R$ 300–500, covers short outages); one machine for QA and prod. Fine for friendly beta clubs, not for promises to paying ones. |
| **C. AWS EC2** (the founder's idea): one `t4g.small` (ARM, 2 vCPU, 2 GB) running the same compose | ~**US$ 7/month** while the t4g.small free trial lasts (reported until 2026-12-31: storage ~US$ 3 + a public IPv4 ~US$ 3.65), then ~**US$ 20–25/month** in São Paulo | Closest to the long-term AWS plan (D-040), everything inside one AWS account, EBS snapshots | **Not free.** Accounts created after 2025-07-15 get a credit-based Free Plan (up to US$ 200 for 6 months), not the old 12 months; the IPv4 address and EBS are billed; easy to leave a costly resource running. The Tunnel can't remove the IPv4 need (GitHub/GHCR pulls are IPv4-only). |
| **D. Serverless free tiers** (Cloud Run or Koyeb + Neon/Supabase Postgres + Upstash Redis) | $0 | No server to patch | Cold starts (against the SPEED pillar); Neon free is 0.5 GB and its São Paulo availability is unclear, Supabase free pauses idle projects; our worker needs an always-on process (LISTEN/NOTIFY), which scale-to-zero platforms don't give. Many moving parts. |
| **E. All on Cloudflare** (Workers + Hyperdrive/D1 + Queues + R2) | $0 for Workers; **Containers need Workers Paid (US$ 5/month)** | Global, no servers | Our axum/sqlx/tokio backend doesn't run on Workers (WASM) without a large rewrite: compile-time sqlx queries, the job queue, Valkey. Cloudflare Containers could run the image as is, but aren't free. A later idea, not for the first release. |

**Decided 2026-11-05 (D-053):** one free-tier EC2 instance running QA's compose, with the data kept on its disk,
Grafana Cloud for metrics and logs, and no RDS or ElastiCache until revenue pays for them; later a paid account, a
bigger instance or Kubernetes. The comparison below is kept for the record. Points to settle in P1:
- Which free tier the AWS account has: accounts opened after 2025-07-15 get credits (about US$ 100–200 for 6 months,
  then the account must upgrade); older ones get 750 h/month of a `t3.micro` (2 vCPU, **1 GB RAM**) for 12 months.
  The public IPv4 (~US$ 3.65/month) and EBS beyond the allowance are billed either way.
- Memory: QA's app containers use ~150 MB, but its self-hosted observability uses ~700 MB (Grafana ~350, Alloy ~125,
  Loki ~115, Prometheus ~100, measured 2026-11-05). On 1 GB, production should send metrics and logs to Grafana Cloud's
  free tier (only Alloy on the box; the same dashboards import there) or use a 2 GB instance.
- Backups off the box (R2, §3) matter more on EC2 than anywhere: one instance, one disk.

### Recommendation
1. **Use the free building blocks above in every case**: web on Pages, uploads and backups in R2, Grafana Cloud,
   Sentry, Resend, Expo/FCM, the Tunnel.
2. **For the API, Postgres and Valkey, start with A (Oracle Always Free, São Paulo)**: one ARM VM running the same
   `docker compose` as QA (minus the self-hosted observability), upgraded to Pay As You Go to avoid idle reclaim
   (with a budget alert at US$ 0.01). **Fall back to B (the NUC)** if Oracle has no capacity: same compose, same
   backups.
3. **Keep moving cheap:** the database lives on the VM's disk, with continuous backups to R2 (§3). Changing hosts
   later (Oracle → AWS or NUC → Oracle) means restoring the latest backup on the new host and pointing the tunnel at
   it: tens of minutes.
4. **When money flows:** move PostgreSQL to a managed service first (RDS/Aurora per D-040, or a paid Neon/Supabase in
   São Paulo), then the API (EC2/Lambda per D-040, or keep the VM). D-040's Lambda + Aurora stays the long-term target;
   this is the bridge.

If A or B is chosen, it supersedes the "production on AWS" part of D-040 for the first release: record it as a new
decision (D-050) and rewrite P1 in `docs/build-plan.md`.

### Shape of the first production
```
runflow.club            → Cloudflare Pages (landing + the web app, one build), www → apex
api.runflow.club        → Cloudflare Tunnel → VM: api + worker, postgres 18, valkey (compose)
uploads                 → R2 bucket (S3 settings), served through the API as today (sandboxed /assets)
backups                 → R2 bucket (WAL archive + nightly dumps)
observability           → Grafana Cloud (OTLP from the API), Sentry (prod projects exist)
qa.runflow.club         → unchanged (NUC, disposable)
```
The session cookie works across `runflow.club` and `api.runflow.club` with `COOKIE_DOMAIN=.runflow.club` (same site)
and `CORS_ORIGINS=https://runflow.club`; or keep the app same-origin with a tiny Pages Function proxying `/api`
(counts against the Workers free tier, 100k requests/day). Decide in P1.

**Learned 2026-11-04:** whatever host the apps call, production must answer `/api/*` there itself (the same-origin
proxy above, or the VM serving web + API as QA does), never through a redirect to another host: phones drop the
`Authorization` header on a cross-host redirect and a 302 turns a POST into a GET. Each environment gets its own app
build (`mobile/eas.json`: QA builds call `qa.runflow.club`; production builds will call the production domain).

---

## 3. Persistence and backups (the part that must not be improvised)

- **PostgreSQL on the VM's disk** (Oracle block volume / the NUC's SSD), data in a named volume, the version pinned
  (18).
- **Continuous archiving with WAL-G (or pgBackRest) to R2:** base backup weekly, WAL segments as they fill, so a
  restore can land on any minute (point-in-time recovery). R2 has no egress fees, so restores cost nothing.
- **Nightly `pg_dump`** to R2 as a second, simple safety net (kept 30 days with an R2 lifecycle rule).
- **Restore drill**: a script that restores the latest backup into a scratch database and runs the API's checks
  against it, monthly. A backup that was never restored isn't a backup.
- **Uploads** are already in object storage (R2 in prod), so the VM holds only the database and caches.
- **Valkey** needs no persistence (D-047: ephemeral by design).
- **Before every deploy with a migration:** the deploy script takes a fresh base backup first.

---

## 4. From "wipe anything" to incremental changes (done early: D-051, 2026-11-04)

The founder made the switch on 2026-11-04, before the beta: testers use QA with real accounts.
- [x] `backend/migrations/0001_bootstrap.sql` frozen as QA applied it; every schema change is a new `NNNN_*.sql`
      (`backend/scripts/new-migration.sh`), never editing a shipped one (`scripts/applied-migrations.sha384` +
      `check.sh`); `api/schema.sql` stays the full picture (the contract test proves migrations == schema).
- [ ] **Expand, then contract** (`docs/hosting.md` §3): a release adds columns or tables and stops using old ones; a
      later release drops them. A rollback then never meets a schema it can't read.
- [x] QA stops resetting itself on schema changes (`ops/qa/update.sh`): it migrates like production, and
      `reset-db.sh` becomes a manual tool. That makes QA the rehearsal for every production migration.
- [ ] Seed data for QA (a demo club with workouts) instead of an empty database after resets, so testing starts fast.
- [ ] Release flow: every push to main → QA (as today); production deploys are **promoted** by hand from a release tag
      (`v*`) after QA looks good (a `deploy-prod` workflow or a script on the VM). Smoke tests against production after
      each deploy (D-034).
- [ ] Data-safety tests: a CI job that applies the new migrations to a copy of the previous release's schema with data.

---

## 5. Accounts and settings production needs

| Service | What to set up | Cost |
|---|---|---|
| Cloudflare | Pages project for the web; R2 buckets (uploads, backups) + an API token; a second tunnel (prod); DNS `api.runflow.club`; `runflow.club` stops redirecting to QA | $0 |
| Oracle (or the NUC) | Account (needs a card for identity, nothing charged within Always Free), the VM in São Paulo, PAYG upgrade + a budget alert | $0 |
| **Strava** | **A second API app for production** (one callback domain per app: QA keeps `qa.runflow.club`, prod gets `runflow.club`). New apps start in "Single Player Mode" (1 athlete); the API settings page upgrades to **10 athletes** by itself; more than 10 needs Strava's review (privacy policy, terms, screenshots, the coaching use case; replies take weeks). **Strava's policy forbids feeding its data to AI features**: keep the assistant on Runflow's own data | $0 |
| Google | Add the production origin to the OAuth client (sign-in only uses basic scopes) | $0 |
| Resend | `runflow.club` is already the sending domain; a prod API key | $0 |
| Sentry | Prod DSNs exist (S12) | $0 |
| Grafana Cloud | Create the stack; OTLP endpoint + token into the prod `.env` | $0 |
| Firebase + Expo | FCM key uploaded to EAS: phone push on Android (`docs/ops/push-notifications.md`) | $0 |
| Stripe | Stays in test mode through the beta (D-016); live keys and a CNPJ when charging | $0 |
| Apple Developer | Only for iOS TestFlight/App Store and Sign in with Apple (D-007) | US$ 99/year, later |
| Google Play | Only for the Play Store (internal testing tracks included) | US$ 25 once, later |

---

## 6. Getting the app to real people

- **Android:** the EAS APK link (sideload) for the beta; Play Store internal testing once the US$ 25 is worth it
  (installs and updates become one tap).
- **iPhone:** until the Apple account exists, iPhone users use the **web app installed from Safari** (it supports Web
  Push since iOS 16.4 when installed). Every feature exists on the web.
- **Invite links that open the app:** host `/.well-known/assetlinks.json` (Android, with the EAS key's SHA-256) and
  `apple-app-site-association` (iOS, later) on the production domain.

---

## 7. Tracking: knowing what people do (free and LGPD-friendly)

Selling needs two answers: **do clubs reach the moment Runflow is useful** (counts and funnels), and **where do they
get stuck** (watching real use). **Decided 2026-11-05 (D-054):** points 1 and 3 are built on QA (S13d): the Grafana
**Product** dashboard and a self-hosted Umami at `analytics-qa.runflow.club` (Umami Cloud was dropped: no São Paulo
region).

1. **Product numbers from our own database, no tracker needed** (do this first): signups, clubs created, invites
   sent/accepted, workouts assigned and released, completions, Strava connections, per week and per club. A Grafana
   "Produto" dashboard on a read-only Postgres role (the dashboards-as-code script already exists). Nothing leaves our
   servers and it answers the activation question directly.
2. **Activation funnel** (define now, measure in 1): landing → "Criar meu clube grátis" → club created → first invite
   → first workout assigned → first completion by a student → second week planned. That's the number to improve.
3. **Web and app behaviour: Umami, self-hosted** (the founder's idea, and the best fit). Cookieless, so no consent
   banner; data stays on our server in Brazil; one Node container (~150–250 MB) using its own database on the same
   Postgres; page views, referrers, UTM campaigns, devices, custom events (`umami.track("treino_atribuido")`), and
   funnel, journey and retention reports. The phone app has no SDK but can post the same events to Umami's
   `/api/send`. Events carry no personal data (club size bucket, role, modality at most).
4. **Landing page visits: Cloudflare Web Analytics** (free, no cookies, one switch on Pages) if the landing moves to
   Pages; otherwise Umami covers it.
5. **Seeing where people get stuck** (once the beta starts): at 3–5 clubs, watching beats counting.
   - Moderated sessions: a 30-minute screen share with each new coach doing their first week; write down every hesitation.
   - A "Mandar feedback" entry in the app menu (text + the current screen, stored in our own database).
   - A one-question check-in after week 2 ("O que quase te fez desistir?").
   - Session replay only if those leave gaps: **PostHog Cloud** free (~1M events and ~5k recordings/month, inputs
     masked) or **Microsoft Clarity** (free, unlimited, heatmaps). Both set cookies and are another processor, so they
     need consent and a line in the privacy policy; beta clubs only.

**Considered and set aside for now:** Plausible CE (needs ClickHouse, over 1 GB of RAM: too heavy for a small VM),
PostHog self-hosted (needs ~16 GB), Matomo (PHP + MySQL; heatmaps and funnels are paid plugins), OpenReplay
self-hosted (heavy), GoatCounter (tiny, but page views only, no events or funnels).

## 8. SEO (the landing is a client-rendered SPA today)

- **Prerender the public pages** at build time (landing, pricing, future content pages) into static HTML, while the app
  stays an SPA (D-004 holds: no server rendering at runtime). Vite can render `/` with `react-dom/server` in a build
  script; Pages serves the static file.
- **Basics:** a `<title>` and meta description per page, Open Graph/Twitter cards with an OG image (the Ritmo mark on
  Azul Flow), `robots.txt`, `sitemap.xml`, canonical URLs, `lang="pt-BR"`, JSON-LD (`SoftwareApplication`, `FAQPage`,
  `Organization`).
- **Pages that match what clubs search for** (pt-BR): "app para assessoria de corrida", "planilha de treino online
  para alunos", "software para treinador de corrida", "treino de natação para equipes", "treino funcional para
  alunos", "alternativa ao sisrun" (an honest comparison page: price, speed, features).
- **Content later:** a small blog or guides (Astro on Pages if it grows) with the quick-text builder as the hook
  ("monte um treino digitando como no WhatsApp").
- **Measure:** Google Search Console and Bing Webmaster Tools (free); Lighthouse budgets are already in CI for JS size.

---

## 9. Marketing: the first clubs

- **Who:** small and medium running *assessorias* in Brazil (5–100 students) using spreadsheets, WhatsApp or sisrun;
  then swimming teams and functional/gym groups (the landing now says Corrida, Natação, Ciclismo, Funcional).
- **Offer:** free up to 10 students with every feature, Pro R$ 19,90 vs sisrun's R$ 99 + R$ 79 activation (§3 of
  root.md); "a gente importa sua planilha" (CSV import) and a white-glove setup for the first clubs.
- **Founder-led beta (Phase 4):** 3–5 friendly clubs, set up together, a WhatsApp group for feedback, a weekly check
  on the activation funnel (§7). Ask each for a quote and permission to show their logo.
- **Channels that cost nothing:**
  - **Instagram** (where clubs live): short reels of the quick-text builder turning
    `10' aquec + 6x1km @4:30 c/ 2' trote` into a workout, the student's Hoje, Strava syncing by itself.
  - Direct messages to coaches.
  - Running groups and Strava clubs, race expos and local races (partner with organizers: Provas is built in).
  - Running stores.
  - Referrals: an invited coach brings their students.
- **Kit to prepare:** a one-page pt-BR presentation, a 60-second demo video, onboarding guide for coaches (how to
  invite, plan a week, release it), FAQ answers (LGPD, Strava, price), the comparison page.
- **Pricing stays honest during the beta:** every club free (D-016), limits enforced, "plano Pro quando lançar".

---

## 10. Blockers before inviting real people (legal and trust)

- [ ] **Termos de uso e Política de privacidade (LGPD)** naming every processor (Cloudflare, Oracle or AWS, Resend,
      Strava, Google, Sentry, Grafana, Expo/Firebase, Stripe; PostHog if used), what's collected, retention, rights
      (export and delete already exist in the app), contact. Linked from the landing, sign-in and the apps. Needed by
      Strava's review and Google too.
- [ ] Strava production app (§5) and the 10-athlete upgrade; plan the review before club 2–3 (beyond 10 athletes).
- [ ] A contact channel and a status line (e-mail + WhatsApp) for clubs when something breaks.
- [ ] CNPJ and Stripe live keys only when charging (Phase 5).

---

## 11. Proposed order of work

| # | Step | Who | Cost |
|---|---|---|---|
| 1 | Full manual test round on QA, fixes as they come | Founder + agent | $0 |
| 2 | ~~Decide hosting~~ Decided: one AWS EC2 instance running the compose (D-053); P1 rewritten | Founder | — |
| 3 | Legal texts (LGPD terms + privacy), drafted by the agent, reviewed by the founder | Both | $0 |
| 4 | Production compose + WAL-G/pg_dump backups to R2 + restore drill script + deploy-by-tag (P1a) | Agent | $0 |
| 5 | Web on Cloudflare Pages, `runflow.club` live with the app, `api.runflow.club` via the tunnel (P1b) | Agent + founder (accounts) | $0 |
| 6 | Third-party production setup: Strava prod app, Google origin, Grafana Cloud, Sentry prod, FCM/EAS push (P1c) | Founder (consoles) + agent | $0 |
| 7 | Incremental migrations from here (§4): freeze the bootstrap, expand/contract, QA migrates instead of resetting | Agent | $0 |
| 8 | ~~Tracking: the Product dashboard from the database, then Umami self-hosted, §7~~ Done on QA (S13d, D-054) | Agent | $0 |
| 9 | SEO: prerendered landing, meta/OG/sitemap/JSON-LD, the first content pages | Agent | $0 |
| 10 | Beta: 3–5 friendly clubs, the marketing kit, weekly funnel review | Founder | $0 |
| 11 | X16 native extras (Google sign-in, widget, Health) when the dev build and accounts exist | Agent | $0 |
| 12 | When paying: managed Postgres, Apple/Play accounts, Stripe live, Resend/Grafana paid tiers as needed | Founder | per need |

---

## 12. Questions for the founder

1. ~~Hosting for the first release~~ AWS EC2 running the compose (D-053). Uploads: S3 or Garage on the instance?
2. One domain (`runflow.club` for the landing and the app) or `app.runflow.club` for the app?
3. ~~Tracking~~ Umami self-hosted + the Product dashboard (D-054). Session replay later, only if the beta shows gaps?
4. Who are the first 3–5 clubs, and when do we invite them?
5. Strava: create the production app now (it starts at 1 athlete; you can raise it to 10 yourself)?

---

## Sources (checked 2026-11-03; prices and limits change, verify before relying on them)
- AWS Free Tier changes: [AWS Builder Center](https://builder.aws.com/content/3Kkt4kNiDSUnO3n6db2weSNubzE/the-dollar0-aws-account-in-2026-free-plan-credits-guardrails), [infratally](https://infratally.com/articles/aws-free-tier-2026/); t4g.small trial: [Classmethod](https://dev.classmethod.jp/en/articles/ec2-t4g-small-free-tier-2026/), [AWS re:Post](https://repost.aws/articles/ARvGyYizvJQGCr0ymdgj3HIA/announcing-amazon-ec2-t4g-free-trial-extension)
- Oracle Always Free: [Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm), [2026 report](https://braindetox.kr/en/posts/oracle_always_free_backend_2026.html)
- Cloudflare R2: [R2 pricing (dev docs)](https://60eb615a.previews.developers.cloudflare.com/r2/pricing/index.md), [Upstash KB](https://upstash.com/kb/cloudflare-r2-pricing-in-2026-storage-operations-and-real-monthly-bills); Containers: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/index.md), [flarecalc](https://flarecalc.com/calculators/containers/); Web Analytics: [cloudflare.com/web-analytics](https://cloudflare.com/web-analytics)
- Neon: [plans](https://neon.com/docs/introduction/plans); PostHog: [pricing](https://posthog.com/pricing?utm_category=ai); Grafana Cloud: [last9](https://last9.io/blog/grafana-cloud-pricing/)
- Strava: [rate limits and athlete capacity](https://developers.strava.com/docs/rate-limits/), [2026 changes](https://tryterra.co/blog/strava-api-changes-2026)
- Expo: [plans](https://docs.expo.dev/billing/plans/); Resend: [free tier](https://resend.com/blog/new-free-tier)
