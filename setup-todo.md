# Setup to-do (founder)

What's still open for the environments. The full guide for building QA from zero (and what each piece does) is
`docs/ops/qa-pi.md`. Done items stay here, crossed out, so the history is visible; I keep the list current as steps land.

## Done (checked 2026-11-03)

QA is live at **https://qa.runflow.club**:
- **Domain and mail:** DNS is on Cloudflare with the mailboxes intact, and `runflow.club` redirects to QA. HTTP goes to HTTPS.
- **Pi and tunnel:** the tunnel connects in São Paulo, `doctor` is all green, and Debian is up to date (rebooted on the new kernel).
- **E-mail:** Resend sends from `contato@`. Sign-in codes arrive, and club e-mails go out in the club's colors.
- **Strava:** the webhook is subscribed (id 382315).
- **Deploys:** each one arrives within 5 minutes of a push (`runflow-update` timer). When the database schema changes, QA
  starts over with an empty database by itself (D-030). The nightly backup runs at 03:30 (database and storage).
- **Speed:** the API answers in about 1 ms on the Pi and about 30 ms more through the tunnel. Bundles are served by Cloudflare's edge.
- **Storage:** uploads (logos, avatars) live in Garage, a self-hosted S3, next to the API. Production will point the same settings at any S3.

## Now

- [x] ~~**Power-cycle the Pi** after the 2026-11-02 kernel update.~~ Done; it's running the new kernel.
- [x] ~~**Google sign-in**: `https://qa.runflow.club` as an authorized JavaScript origin of the web client.~~ Done (set early on).
  "Continuar com Google" is live on QA (S9a). For local dev against the real API, also add `http://localhost:8080`.
- [x] ~~**Logo**: pick one of the concepts.~~ Ritmo (2026-11-03), now applied everywhere (B1b).
- [ ] **Serve the whole web app from the edge** (`docs/ops/qa-pi.md` §6, 5 minutes). Cloudflare → runflow.club → Caching:
  - **Cache Rules** → rule `QA web app at the edge`, expression
    `(http.host eq "qa.runflow.club" and not starts_with(http.request.uri.path, "/api/"))` → Eligible for cache ·
    Edge TTL "Use cache-control header if present" · Browser TTL "Respect origin TTL".
  - Rule `QA API`, expression `(http.host eq "qa.runflow.club" and starts_with(http.request.uri.path, "/api/"))` → Bypass cache.
  - **Tiered Cache** on, if it isn't yet.
  - Purge token: My Profile → API Tokens → Custom token, **Zone · Cache Purge · Purge**, zone runflow.club only.
    On the Pi, add `CF_CACHE_PURGE_TOKEN=<token>` and `CF_ZONE_ID=<runflow.club → Overview, right column>` to
    `~/runflow/ops/qa/.env` (or send them to me and I'll put them there), then `./purge-edge.sh`.
  - Check: `curl -sI https://qa.runflow.club/ | grep cf-cache-status` says `HIT` (the first request after a purge says `MISS`).
- [ ] **Change the Pi's password**: `ssh runflow@runflow-qa.local`, then `passwd`. The current one was shared in chat.
  Tell me if you want me to keep root access. If so, the cleanest way is a sudoers rule only for `apt` and `systemctl`.
- [ ] **Keep a copy of the Pi's secrets** in your password manager: `scp runflow@runflow-qa.local:runflow/ops/qa/.env ~/runflow-qa.env`.
  It holds the only copy of the database password, `ENCRYPTION_KEY` (unlocks the stored Strava tokens) and Garage's keys.
- [ ] **Club sites** (`paceforte-qa.runflow.club`, S9b): Cloudflare Zero Trust → the tunnel → Routes → Add route →
  Published application: subdomain `*`, domain `runflow.club`, service `http://web:80`. If Cloudflare doesn't create it,
  add a proxied DNS record `*` CNAME → `<tunnel-id>.cfargotunnel.com`. Explicit records (`qa`, `www`, mail) keep winning.
  Then `https://<club-slug>-qa.runflow.club` opens that club's sign-in. The Pi is already configured.
- [ ] **Smoke tests on QA** (S11): one random secret saved in two places, so CI can run the main loop on QA after each deploy.
  `K=$(openssl rand -hex 32)`, then `gh secret set SMOKE_KEY --body "$K"` (or GitHub → Settings → Secrets → Actions) and,
  on the Pi, `SMOKE_KEY=<same value>` in `~/runflow/ops/qa/.env` followed by `./update.sh`. Until then the QA job skips
  itself; the smoke run against a backend started in CI needs nothing.
- [ ] **Strava**: strava.com/settings/api → Authorization Callback Domain = `qa.runflow.club`. "Conectar com Strava" is live on QA
  (S9a) and fails at Strava until this is set.

## Before the private beta

- [ ] **Off-site backups.** Today the dumps sit on the same SD card as the database. Create a Cloudflare R2 bucket
  `runflow-backups` (10 GB free) and an R2 API token with Object Read & Write on that bucket only. I'll make `backup.sh`
  copy every dump there and add a restore drill (S8).
- [ ] **An SSD for the Pi** (M.2 HAT + NVMe, or a USB 3 SSD). SD cards wear out under a database. Today's card is fine while
  data is disposable (D-030).
- [ ] **Strava app review** with the coaching use case: students consent to share with their club's trainers. Keep the
  written reply on file (`root.md` §11.2).
- [ ] **Terms and privacy policy (LGPD)** naming the processors: Cloudflare, Resend, Strava, Google, and Sentry once S12 lands.

## When these steps land (I'll ping you)

| Step | What you'll do |
|---|---|
| ~~B1 Logo~~ | ~~Pick one of the concepts~~ Done: Ritmo |
| S12 Sentry | sentry.io → org → two projects (Rust: `runflow-api`, React: `runflow-web`) → their DSNs: `SENTRY_DSN` in the Pi's `.env`, GitHub variable `VITE_SENTRY_DSN` |
| S13 Grafana | Choose between Grafana Cloud's free tier (nothing to run) and the stack on the Pi (no account, uses ~1 GB RAM) |

## Handy (on the Pi, in `~/runflow/ops/qa`)

| Task | Command |
|---|---|
| Status and logs | `docker compose ps` · `docker compose logs -f api` |
| Deploy now | `./update.sh` |
| Pin or roll back | `RUNFLOW_TAG=sha-<commit>` in `.env`, then `./update.sh` |
| Health of everything | `docker compose run --rm api doctor` |
| Drop the edge copy of the app | `./purge-edge.sh` |
| Start over with an empty database and storage (D-030) | `./reset-db.sh --yes` (takes a backup first) |
