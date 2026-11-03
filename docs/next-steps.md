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
decision (D-049) and rewrite P1 in `docs/build-plan.md`.

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

## 4. From "wipe anything" to incremental changes (when staging passes)

D-030 says it: at the beta, freeze the bootstrap and return to one migration per change.
- [ ] Freeze `backend/migrations/0001_bootstrap.sql` as applied; every schema change from then on is a new
      `NNNN_*.sql`, never editing an applied one; `api/schema.sql` stays the full picture (the contract test keeps
      proving migrations == schema).
- [ ] **Expand, then contract** (`docs/hosting.md` §3): a release adds columns or tables and stops using old ones; a
      later release drops them. A rollback then never meets a schema it can't read.
- [ ] QA stops resetting itself on schema changes (`ops/qa/update.sh`): it migrates like production, and
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

1. **Product numbers from our own database, no tracker needed:** signups, clubs created, invites sent/accepted,
   workouts assigned, completions, Strava connections, per week. A small "Crescimento" dashboard (Grafana with a
   read-only Postgres user, or a `/dev`-style admin page). Nothing leaves our servers.
2. **Landing page visits: Cloudflare Web Analytics** (free, no cookies, so no consent banner; one switch on Pages):
   page views, referrers, countries, devices, Core Web Vitals.
3. **Funnels and click paths in the app (optional): PostHog** free (≈1M events/month). Use it cookieless (in-memory
   persistence), no autocapture of inputs, no session replay at first, no personal data in events; mention it in the
   privacy policy. Or self-host **Umami** on the VM (free, cookieless, data stays in Brazil) if we'd rather not add a
   processor.
4. Define the activation funnel now: landing → "Criar meu clube grátis" → club created → first invite → first workout
   assigned → first completion by a student → second week planned. That's the number to improve.

---

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
| 2 | Decide hosting (A Oracle / B NUC / C AWS) → D-049; rewrite P1 in the build plan | Founder | — |
| 3 | Legal texts (LGPD terms + privacy), drafted by the agent, reviewed by the founder | Both | $0 |
| 4 | Production compose + WAL-G/pg_dump backups to R2 + restore drill script + deploy-by-tag (P1a) | Agent | $0 |
| 5 | Web on Cloudflare Pages, `runflow.club` live with the app, `api.runflow.club` via the tunnel (P1b) | Agent + founder (accounts) | $0 |
| 6 | Third-party production setup: Strava prod app, Google origin, Grafana Cloud, Sentry prod, FCM/EAS push (P1c) | Founder (consoles) + agent | $0 |
| 7 | Incremental migrations from here (§4): freeze the bootstrap, expand/contract, QA migrates instead of resetting | Agent | $0 |
| 8 | Tracking: Cloudflare Web Analytics + the activation dashboard from the database | Agent | $0 |
| 9 | SEO: prerendered landing, meta/OG/sitemap/JSON-LD, the first content pages | Agent | $0 |
| 10 | Beta: 3–5 friendly clubs, the marketing kit, weekly funnel review | Founder | $0 |
| 11 | X16 native extras (Google sign-in, widget, Health) when the dev build and accounts exist | Agent | $0 |
| 12 | When paying: managed Postgres, Apple/Play accounts, Stripe live, Resend/Grafana paid tiers as needed | Founder | per need |

---

## 12. Questions for the founder

1. Hosting for the first release: A (Oracle, São Paulo), B (the NUC), or C (AWS EC2, not free)?
2. One domain (`runflow.club` for the landing and the app) or `app.runflow.club` for the app?
3. Tracking: Cloudflare Web Analytics only, or also PostHog (another processor in the privacy policy), or self-hosted
   Umami?
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
