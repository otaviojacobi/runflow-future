# Setup to-do (founder)

What's still open for the environments. The full guide for building QA from zero (and what each piece does) is
`docs/ops/qa-pi.md`. Tick boxes here as you go; I keep this list current as steps land.

## Done (checked 2026-11-02)

QA is live at **https://qa.runflow.club**:
- **Domain and mail:** DNS is on Cloudflare with the mailboxes intact, and `runflow.club` redirects to QA. HTTP goes to HTTPS.
- **Pi and tunnel:** the tunnel connects in São Paulo and `doctor` is all green. Debian updates are installed; the reboot to finish them is pending (see Now).
- **E-mail:** Resend sends from `contato@`; sign-in codes arrive.
- **Strava:** the webhook is subscribed (id 382315).
- **Deploys:** each one arrives within 5 minutes of a push (`runflow-update` timer). The nightly database backup runs at 03:30.
- **Speed:** the API answers in about 1 ms on the Pi and about 30 ms more through the tunnel. Bundles are served by Cloudflare's edge.
- **Storage:** uploads (logos, avatars) live in Garage, a self-hosted S3, next to the API. Production will point the same settings at any S3.

## Now

- [ ] **Power-cycle the Pi** (unplug, wait 10 s, plug in). It didn't come back from the reboot after the 2026-11-02
  kernel update. If it's still not on the network after 3 minutes, plug in HDMI + keyboard and tell me what the screen
  shows. The containers and timers start on their own once it boots.
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
  It holds the only copy of the database password and `ENCRYPTION_KEY`, which unlocks the stored Strava tokens.
- [ ] **Google sign-in**: Google Cloud → APIs & Services → Credentials → the Web client → Authorized JavaScript origins:
  `https://qa.runflow.club` and `http://localhost:8080`. The "Continuar com Google" button is live on QA now (S9a); until the
  origin is added, Google answers it with an error.
- [ ] **Strava**: strava.com/settings/api → Authorization Callback Domain = `qa.runflow.club`. "Conectar com Strava" is live on QA
  now (S9a) and fails at Strava until this is set.

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
| B1 Logo | Pick one of the concepts (or redirect) |
| S9b Club subdomains | Tunnel → Routes → add `*.runflow.club` → `http://web:80` and a proxied DNS record `*` (club sites `<club>-qa.runflow.club`, D-029) |
| S11 Smoke tests | One random secret, `openssl rand -hex 32`, saved twice: as GitHub secret `SMOKE_KEY` and as `SMOKE_KEY=` in the Pi's `.env` |
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
| Start over with an empty database (D-030) | `./reset-db.sh --yes` (takes a backup first) |
