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
  starts over with an empty database by itself (D-030). QA keeps no backups (D-039): it's disposable.
- **Speed:** the API answers in about 1 ms on the Pi and about 30 ms more through the tunnel. Bundles are served by Cloudflare's edge.
- **Storage:** uploads (logos, avatars) live in Garage, a self-hosted S3, next to the API. Production will point the same settings at any S3.
- **Billing:** QA runs the billing simulation (`BILLING_SIMULATION=true`): "Assinar o Pro" opens Runflow's own test checkout,
  nothing is charged (D-016). Real Stripe (test mode) is optional, see below.
- **Push:** VAPID keys are in the Pi's `.env`. On QA, install the app (or use Chrome/Firefox on a computer), then
  Perfil → Notificações → "Notificações neste aparelho" → Ativar.
- **Redis** (D-047, 2026-11-03): nothing to do. QA's compose file now runs Redis next to Postgres (no persistence,
  128 MB) and gives the API its address; the next deploy (`update.sh`) starts it by itself. The same deploy changes the
  schema (sign-in codes left Postgres), so QA starts over with an empty database once (D-030): sign in again.
  `docker compose run --rm api doctor` shows a `redis ok` line.

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
- [x] ~~**Change the Pi's password** / **keep a copy of the Pi's secrets**~~ Not needed (D-039): QA is disposable and its
  security can stay simple. If the Pi's `.env` is lost, write a new one and run `./reset-db.sh --yes`.
- [ ] **Move QA to the Intel NUC** (D-046; replaces fixing the Pi's power supply). Your part, then I take over by SSH:
  1. BIOS: set "power on after AC loss" (so it comes back after an outage); boot from USB.
  2. Install **Debian 13 (amd64) netinst**: hostname `runflow-nuc` (the Pi keeps `runflow-qa` until it's off), user
     **`runflow`**, no desktop; select only "SSH server" and "standard system utilities". Use the whole disk.
  3. Log in on the NUC (or by SSH with the password) and install Docker, git and the `.local` name:
     ```sh
     sudo apt-get update && sudo apt-get install -y ca-certificates curl git avahi-daemon
     sudo install -m 0755 -d /etc/apt/keyrings
     sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
     echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
     sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
     sudo usermod -aG docker runflow
     ```
  4. From this computer, give me access: `ssh-copy-id runflow@runflow-nuc.local` (in Claude Code: `! ssh-copy-id runflow@runflow-nuc.local`).
  5. Tell me it's ready. I'll copy the Pi's `.env`, clone the repo, start the stack and the update timer, run the checks,
     then stop the Pi (the tunnel follows the token, nothing to change in Cloudflare).
- [ ] **The Pi's power supply** (urgent): the kernel logs repeated "Undervoltage detected" (40+ times on 2026-11-03), and
  writes to the SD card came out empty twice (the checkout and then git itself got corrupted; I re-cloned it, the old copy
  is in `~/runflow.broken-20261103`). Use the official Raspberry Pi 27 W USB-C supply (5.1 V / 5 A) and a short, good cable.
- [ ] **Grafana for QA** (D-041, 2 minutes): Cloudflare Zero Trust → Networks → Tunnels → the QA tunnel → Public hostnames
  (or Routes) → Add: subdomain `grafana-qa`, domain `runflow.club`, service `http://grafana:3000`. Then open
  https://grafana-qa.runflow.club and sign in with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` from your `.env.qa`
  (the same values are in the Pi's `.env`). The "Runflow QA" dashboard is the home page: API requests, latency and
  errors, jobs, database connections, the Pi's CPU/memory/disk/temperature, and the logs (Explore → Loki for searches,
  e.g. `{service="api"} |= "error"`).
- [ ] **Smoke tests on QA** (S11): one random secret saved in two places, so CI can run the main loop on QA after each deploy.
  `K=$(openssl rand -hex 32)`, then `gh secret set SMOKE_KEY --body "$K"` (or GitHub → Settings → Secrets → Actions) and,
  on the Pi, `SMOKE_KEY=<same value>` in `~/runflow/ops/qa/.env` followed by `./update.sh`. Until then the QA job skips
  itself; the smoke run against a backend started in CI needs nothing.
- [ ] **Strava**: strava.com/settings/api → Authorization Callback Domain = `qa.runflow.club`. "Conectar com Strava" is live on QA
  (S9a) and fails at Strava until this is set.

- [x] **Stripe in test mode** (B3, 2026-11-03): the founder's sandbox key is in `.env.qa` and the NUC's `ops/qa/.env`;
  `runflow stripe-setup` created the prices (from `api/plans.json`), the portal configuration and the webhook endpoint
  `https://qa.runflow.club/api/v1/webhooks/stripe` (its secret went straight into the env files). QA now uses Stripe's
  real Checkout with test cards (4242 4242 4242 4242); the simulation is off there. Production keys wait for P1 (the
  business verification).

## Before the private beta

- [x] ~~**Off-site backups** / **an SSD for the Pi**~~ Not needed (D-039): the beta runs on production (D-040), whose
  database (Aurora) has its own backups.
- [ ] **Production setup (P1, its own session).** AWS account (sa-east-1) for Lambda, Aurora and S3; Cloudflare Pages for
  the web app; Stripe live keys; Sentry and Grafana Cloud projects; Resend's production domain. I'll prepare the list of
  accounts and values at the start of that session.
- [ ] **Strava app review** with the coaching use case: students consent to share with their club's trainers. Keep the
  written reply on file (`root.md` §11.2).
- [ ] **Terms and privacy policy (LGPD)** naming the processors: Cloudflare, Resend, Strava, Google, and Sentry once S12 lands.

## When these steps land (I'll ping you)

| Step | What you'll do |
|---|---|
| ~~B1 Logo~~ | ~~Pick one of the concepts~~ Done: Ritmo |
| ~~S12 Sentry~~ | Done (2026-11-03): org `runflow-zw`, projects `runflow-backend-qa`, `runflow-frontend-qa`, `runflow-backend-prod`, `runflow-frontend-prod` (errors only, free features). QA keys are in the Pi's `.env` and your `.env.qa`; production keys wait in your local `.env.prod` (git-ignored) for P1 |
| S13 Grafana Cloud | Production only (D-040, D-041), in the production session (P1): a free stack's OTLP endpoint and token |

## Handy (on the Pi, in `~/runflow/ops/qa`)

| Task | Command |
|---|---|
| Status and logs | `docker compose ps` · `docker compose logs -f api` |
| Deploy now | `./update.sh` |
| Pin or roll back | `RUNFLOW_TAG=sha-<commit>` in `.env`, then `./update.sh` |
| Health of everything | `docker compose run --rm api doctor` |
| Drop the edge copy of the app | `./purge-edge.sh` |
| Start over with an empty database and storage (D-030) | `./reset-db.sh --yes` (nothing is kept, D-039) |
