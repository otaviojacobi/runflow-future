# Runflow QA on the Raspberry Pi: the full setup guide

QA = what testers and beta clubs use until the beta ends: **https://qa.runflow.club**. `runflow.club` (and `www`)
redirect there. After the beta, everything moves to a cloud (maybe k8s); the images and the database dump move as-is.

QA has been live since 2026-11-02. This is the complete guide, kept for rebuilding the Pi or setting up another
environment; what is still open lives in **`setup-todo.md`** at the repo root. Plan on about **2–3 hours** for a
setup from zero, most of it waiting for DNS and the first image build.

---

## 0. How it fits together

```
browser ──https──▶ Cloudflare (TLS, edge cache, redirects)
                       │  Cloudflare Tunnel (outbound from the Pi: no open ports, works behind CGNAT)
                       ▼
Raspberry Pi 5:  cloudflared ─▶ web (Caddy: the app + /api proxy) ─▶ api (+ worker) ─▶ postgres
                                                                      └─▶ garage (S3: logos, avatars)
                                                                      │
                                                     Resend (e-mail), Strava, Google
```

**Deploys.** You push to `main` → GitHub Actions builds two arm64 images (`runflow-api`, `runflow-web`) and pushes them
to GHCR → a timer on the Pi pulls them every 5 minutes and restarts what changed (the API migrates the database
at start). Roll back by pinning a commit: `RUNFLOW_TAG=sha-<7 chars>` in `ops/qa/.env`.

**Speed.** The whole web app comes from Cloudflare's edge (São Paulo), so the Pi only answers `/api`. JS/CSS have hashed
names and `Cache-Control: immutable`; the app shell (`index.html` for every route, icons, manifest, `sw.js`) is kept at
the edge for an hour by a cache rule (§6), and `update.sh` purges it after each deploy so new versions show up at once.
Browsers revalidate the shell on every load (cheap: answered by the edge). The installed app (PWA service worker) keeps
the shell on the device after the first visit. Measured 2026-11-02: API ~1 ms inside the Pi, ~30 ms extra through the
tunnel; database queries 0.1–0.8 ms; SD card commits ~1 ms.

---

## 1. Accounts and keys (do these first, in any order)

- [ ] **Cloudflare** account (free).
- [ ] **Resend** (you have it): we'll add the domain in step 3.
- [ ] **Google Cloud**: an OAuth client (step 4). The web "Entrar com o Google" button is switched on in S9; create the client now anyway.
- [ ] **Strava API app** (step 5).
- [ ] **GitHub**: nothing to create; you'll flip two packages to public in step 6.

---

## 2. Move DNS to Cloudflare (GoDaddy stays the registrar)

Today: DNS at GoDaddy, `runflow.club` + `www` on Vercel, e-mail (otavio@, contato@) on GoDaddy. Details in `docs/hosting.md`.

- [ ] Cloudflare → **Add a site** → `runflow.club` → Free plan. It imports your records.
- [ ] Check the imported records **before** switching. They must include:
  - MX `mailstore1.secureserver.net` (10) and `smtp.secureserver.net` (0)
  - TXT `v=spf1 include:secureserver.net -all`
  - TXT `_dmarc` (`v=DMARC1; p=quarantine; …`)
  - anything e-mail related you see in GoDaddy's DNS page (`email`, `autodiscover`, DKIM): copy it if missing.
  - E-mail records: **DNS only** (grey cloud).
- [ ] GoDaddy → My Products → runflow.club → DNS → **Nameservers** → "I'll use my own" → paste Cloudflare's two.
- [ ] Wait until Cloudflare says the site is **Active** (minutes to a few hours). Send yourself an e-mail at otavio@ to confirm mail still works.
- [ ] Cloudflare → SSL/TLS → Edge Certificates: **Always Use HTTPS** on, minimum TLS 1.2.
- [ ] Cloudflare → Caching → **Tiered Cache** on (free, better edge hit rate).

### 2b. `runflow.club` → `qa.runflow.club`

This replaces the Vercel site at `runflow.club`.
- [ ] DNS: delete the Vercel `A` (`runflow.club`) and `CNAME` (`www`); add **proxied** (orange) `AAAA @ 100::` and `AAAA www 100::` (Cloudflare's placeholder for redirect-only names).
- [ ] Rules → **Redirect Rules** → Create → Single redirect:
  - If: hostname equals `runflow.club` **or** hostname equals `www.runflow.club`
  - Then: Dynamic, expression `concat("https://qa.runflow.club", http.request.uri.path)`, status **302** (temporary: the target changes after the beta), preserve query string.

---

## 3. Resend (e-mail)

- [ ] Resend → Domains → **Add** `runflow.club` (region: São Paulo if offered, else us-east-1).
- [ ] Add the records it shows in Cloudflare DNS, **DNS only**: `resend._domainkey` TXT (DKIM) and `send` MX + TXT (SPF). They don't touch your mailboxes.
- [ ] **Verify** in Resend. Until it's verified, use `EMAIL_FROM="Runflow <onboarding@resend.dev>"` (it only delivers to your own Resend account e-mail; fine for your first sign-in).
- [ ] Resend → API Keys → create one with **Sending access** → keep it for `RESEND_API_KEY`.

Your DMARC is `quarantine`: mail from Resend lands in spam until DKIM verifies, so verify before inviting anyone.

---

## 4. Google sign-in (prepare)

- [ ] console.cloud.google.com → new project "Runflow" → APIs & Services → OAuth consent screen: External, app name **Runflow**, support e-mail contato@runflow.club, domain runflow.club.
- [ ] Credentials → Create **OAuth client ID** → Web application → Authorized JavaScript origins: `https://qa.runflow.club` (and `http://localhost:8080` for dev). No redirect URI needed.
- [ ] Keep the **Client ID** for `GOOGLE_CLIENT_ID` (the secret isn't needed).

---

## 5. Strava (prepare)

- [ ] strava.com/settings/api → create the app: name **Runflow**, website `https://qa.runflow.club`, **Authorization Callback Domain** `qa.runflow.club`.
- [ ] Keep **Client ID** and **Client Secret** for `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`.
- [ ] New apps start with a 1-athlete limit (you). Ask Strava for more (and confirm the coaching use case in writing, root.md §11) before inviting clubs.
- [ ] After S9 (the web page `/connect/strava`), create the webhook subscription once (the `.env` has the verify token):

  ```sh
  curl -X POST https://www.strava.com/api/v3/push_subscriptions \
    -F client_id=$STRAVA_CLIENT_ID -F client_secret=$STRAVA_CLIENT_SECRET \
    -F callback_url=https://qa.runflow.club/api/v1/webhooks/strava -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
  ```

---

## 6. Cloudflare Tunnel + images

- [ ] Cloudflare → **Zero Trust** → Networks → Tunnels → **Create a tunnel** → Cloudflared → name `runflow-qa`.
  Copy the **token** (the long string after `--token`) for `TUNNEL_TOKEN`. Skip the install step (it runs in Docker).
- [ ] Start the Pi's stack first (§7c): the tunnel must show **Healthy** before routes can be saved. Then in the tunnel →
  **Routes** → Add route → **Published application**: subdomain `qa`, domain `runflow.club`, service `http://web:80`.
  (Cloudflare creates the `qa` DNS record for you. A laptop that looked the name up before may cache "not found" for a
  while: `resolvectl flush-caches`, or test from the phone.)
- [ ] Cloudflare → runflow.club → Caching → **Cache Rules** → Create rule (serve the web app from the edge):
  - name `QA web app at the edge`; "Custom filter expression" → Edit expression:
    `(http.host eq "qa.runflow.club" and not starts_with(http.request.uri.path, "/api/"))`
  - Cache eligibility **Eligible for cache** · Edge TTL **Use cache-control header if present** (the web image sends
    one hour for the shell, one year for bundles) · Browser TTL **Respect origin TTL** → Deploy.
- [ ] Second rule, so the API is never cached: name `QA API`, expression
  `(http.host eq "qa.runflow.club" and starts_with(http.request.uri.path, "/api/"))` → **Bypass cache** → Deploy.
- [ ] Purge after deploys: Cloudflare → My Profile → API Tokens → Create Token → **Custom token**, permission
  Zone · **Cache Purge** · Purge, zone resources: runflow.club only. Put it in the Pi's `ops/qa/.env` as
  `CF_CACHE_PURGE_TOKEN`, and the zone ID (runflow.club → Overview, right column) as `CF_ZONE_ID`. Test with
  `./purge-edge.sh` → `edge cache purged for qa.runflow.club`. (Skip it and deploys still land, within the hour.)
- [ ] GitHub → repo → **Actions** → check the `images` workflow ran green on `main` (first run: ~15 min for the Rust build).
- [ ] github.com/otaviojacobi?tab=packages → `runflow-api` → Package settings → **Change visibility → Public**. Same for `runflow-web`.
  (The images have no secrets; public means the Pi pulls without logging in.)

---

## 7. The Raspberry Pi

### 7a. The card

A memory card is fine: QA is disposable (D-039) and production runs elsewhere (D-040). Use a decent one
(A2 / "high endurance", 64 GB+); if it dies, flash a new one and follow this guide again.

- [ ] **Raspberry Pi Imager** → Raspberry Pi 5 → **Raspberry Pi OS Lite (64-bit)** → your card → Edit settings:
  hostname `runflow-qa`, username **`runflow`** (the systemd units assume it), your SSH public key, time zone `America/Sao_Paulo`,
  Wi-Fi only if you can't use a cable (cable is better).
- [ ] Boot, then from your laptop: `ssh runflow@runflow-qa.local`

### 7b. System + Docker

```sh
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades        # yes: automatic security updates
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker runflow && exit                 # log in again so the group applies
```

### 7c. Runflow

- Object storage is **Garage** (D-037), in the same compose: set `AWS_ACCESS_KEY_ID` (GK + `openssl rand -hex 16`), `AWS_SECRET_ACCESS_KEY` and `GARAGE_RPC_SECRET` (`openssl rand -hex 32` each) in `ops/qa/.env`; Garage creates the bucket and key on first start, and `doctor` writes a test object.
```sh
git clone https://github.com/otaviojacobi/runflow-future.git ~/runflow
cd ~/runflow/ops/qa
cp .env.example .env && chmod 600 .env
sed -i "s|^POSTGRES_PASSWORD=$|POSTGRES_PASSWORD=$(openssl rand -hex 24)|;
        s|^SESSION_SECRET=$|SESSION_SECRET=$(openssl rand -base64 32)|;
        s|^ENCRYPTION_KEY=$|ENCRYPTION_KEY=$(openssl rand -base64 32)|;
        s|^STRAVA_WEBHOOK_VERIFY_TOKEN=$|STRAVA_WEBHOOK_VERIFY_TOKEN=$(openssl rand -hex 16)|" .env
nano .env    # paste TUNNEL_TOKEN, RESEND_API_KEY, GOOGLE_CLIENT_ID, STRAVA_CLIENT_ID/SECRET (EMAIL_FROM: see step 3)
```

- [ ] Back up `ops/qa/.env` somewhere safe (a password manager). **Never change `ENCRYPTION_KEY`** once people connect Strava.
- [ ] Start: `docker compose up -d` then `docker compose ps` (all `healthy`/`running` after ~1 minute).
- [ ] Check the setup: `docker compose run --rm api doctor` (database ok, e-mail resend, google ok, strava ok, secrets set).
- [ ] Test e-mail: `docker compose run --rm api email-test --to contato@runflow.club`
- [ ] Auto-deploy:

  ```sh
  sudo cp ~/runflow/ops/qa/runflow-*.service ~/runflow/ops/qa/runflow-*.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now runflow-update.timer
  systemctl list-timers 'runflow-*'
  ```

---

## 8. Backups: none (D-039)

QA keeps no backups: its data is disposable, `./reset-db.sh --yes` starts it over, and a schema change does that by
itself. Production's durability comes from Aurora (automated backups, point-in-time restore; D-040, P1).

---

## 8b. Observability (D-041)

`docker-compose.yaml` also runs **Loki** (logs, 7 days), **Prometheus** (metrics, 15 days, 2 GB max), **Grafana Alloy**
(collects) and **Grafana** (UI). Alloy reads every container's logs through the Docker socket, receives the API's
metrics over OTLP (`OTEL_*` settings in the compose file) and adds the Pi's host metrics. Configs live in
`ops/qa/observability/`; the data sources and the "Runflow QA" dashboard are provisioned from there (edit the JSON and
push to change it).

- [ ] Tunnel route: `grafana-qa.runflow.club` → `http://grafana:3000` (Zero Trust → the tunnel → Public hostnames).
- [ ] Sign in with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` from `.env` (set on Grafana's first start; to change
  it later: `docker compose exec grafana grafana cli admin reset-admin-password <new>`).

---

## 9. First run

- [ ] Open **https://qa.runflow.club** → Entrar → your e-mail → the 6-digit code arrives → create your club.
- [ ] https://runflow.club redirects to QA.
- [ ] https://qa.runflow.club/dev/status shows the build plan (what's done).
- [ ] Invite yourself on another address as a student; check the invite e-mail, accept, assign a workout.

### What works on QA today

Built in the real backend (S1–S5): e-mail code sign-in, account, clubs and settings, Club Studio (colors, logo),
personal invites by e-mail (single and spreadsheet), members and groups, workout library and builder, planning,
planilhas, the student side (today, schedule, workout with personal zones, feedback), threads and the feedback inbox,
dashboard, students list and detail, profiles and zones, exercise library, calendar feed (.ics), manual activities,
Strava (backend done; the web return page arrives in S9).

### Not yet (those screens will show errors on QA until their step lands)

| What | Step |
|---|---|
| Google button, Strava connect return page, demo-only paths hidden | S9 |
| Classes and scheduling (aulas, bookings, check-in) | S6 |
| Messages and mural, challenges, races, assessments, reports, assistant | S6b |
| Billing (Stripe test mode), push notifications | S7 |
| Club subdomains `<club>-qa.runflow.club` | S9 (see below) |

### Club subdomains (`myclub-qa.runflow.club`, D-029)

Not implemented end to end yet: clubs can save a subdomain, but nothing serves the club's site at its address
(the server-side "web shell", S9). In QA the address is **one level**, `<club>-qa.runflow.club`, so Cloudflare's free
certificate (`*.runflow.club`) covers it and there's nothing to pay. Production never accepts subdomains ending in `-qa`.
When it lands you'll add, in the tunnel, a public hostname `*.runflow.club` → `web:80` and a proxied `*` DNS record
(explicit records like `qa`, `www` and the mail ones still win).

---

## 10. Day-to-day

| Task | Command (on the Pi, in `~/runflow/ops/qa`) |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f api` (or `web`, `cloudflared`) |
| Deploy now (don't wait 5 min) | `./update.sh` |
| Drop the edge copy of the app | `./purge-edge.sh` (`update.sh` does it after each deploy) |
| Is the edge serving the app? | `curl -sI https://qa.runflow.club/ \| grep cf-cache-status` → `HIT` (`MISS` once after a purge) |
| Roll back / pin a version | set `RUNFLOW_TAG=sha-<commit>` in `.env`, then `./update.sh` |
| Configuration check | `docker compose run --rm api doctor` |
| Database shell | `docker compose exec postgres psql -U runflow -d runflow` |

Production doesn't run here: it's AWS Lambda + Cloudflare Pages + Aurora (D-040), set up in its own session (P1).
