# Hosting: one Raspberry Pi 5 + Cloudflare Tunnel, deploy on push (S8 plan)

This file is the background; the step-by-step for QA is `docs/ops/qa-pi.md` (open items: `setup-todo.md`) (D-028: QA at `qa.runflow.club`, `runflow.club` redirects there).
**Recommended:** Raspberry Pi OS + Docker + the root `docker-compose.yaml` + `cloudflared`, deployed by GitHub Actions over
Tailscale (§3). **Alternative:** balenaCloud (§4). DNS (§1) and the tunnel (§2) are the same either way.

## Current DNS (checked 2026-11-02)

| Record | Value | Notes |
|---|---|---|
| Registrar + DNS | GoDaddy (`ns45/ns46.domaincontrol.com`) | DNSSEC off (nothing to disable before moving) |
| `runflow.club` A | `216.198.79.1` | Vercel |
| `www` | CNAME to `*.vercel-dns-017.com` | Vercel |
| MX | `10 mailstore1.secureserver.net`, `0 smtp.secureserver.net` | GoDaddy e-mail: `otavio@`, `contato@` |
| SPF (TXT on apex) | `v=spf1 include:secureserver.net -all` | keep as is; Resend uses its own `send.` subdomain |
| DMARC (`_dmarc`) | `v=DMARC1; p=quarantine; adkim=r; aspf=r; …` | Resend mail must pass DKIM or it lands in spam |

## 1. Move DNS to Cloudflare (registrar stays GoDaddy)

A Cloudflare Tunnel needs the zone on Cloudflare (CNAME/partial setup is Business-only).
1. Cloudflare → Add site `runflow.club` (Free). It imports the existing records.
2. Compare with the table above: both MX, SPF, DMARC, Vercel A + `www`. Also look in GoDaddy for e-mail helper records (`email`, `autodiscover`, `_autodiscover._tcp`, DKIM) and copy any that are missing.
3. Mail and Vercel records: **DNS only** (grey cloud).
4. GoDaddy → Domain → Nameservers → custom → Cloudflare's two. Mail keeps working (same records).
5. Resend → Domains → add `runflow.club` → add its records in Cloudflare (DNS only): `resend._domainkey` TXT (DKIM), `send` MX + TXT (SPF for the return path). Verify, then `npm run doctor` and `email-test`.

## 2. Tunnel

Cloudflare Zero Trust → Networks → Tunnels → create (`runflow-pi`) → copy the token (`TUNNEL_TOKEN`, a secret).
Public hostnames, all to `http://api:3000`:
- `app.runflow.club` (web app + sign-in: the Google OAuth origin, §7.3)
- `api.runflow.club` (mobile API)
- `*.runflow.club` (club subdomains, Pro): also add a proxied DNS record `*` → `<tunnel-id>.cfargotunnel.com`.
  Universal SSL covers `*.runflow.club` (one level) for free. Explicit records (`www`, mail, `send`) win over the wildcard.

Then: `COOKIE_DOMAIN=.runflow.club`, `PUBLIC_APP_URL=https://app.runflow.club`, `PUBLIC_API_URL=https://api.runflow.club`, `CORS_ORIGINS=https://app.runflow.club`.
Reserved subdomains (never a club's): `app api www mail email smtp imap pop autodiscover send status docs admin` (enforced in S3).
A club's own domain (`treinos.clube.com.br`) = Cloudflare for SaaS custom hostnames: later.
Note for LGPD: Cloudflare terminates TLS, so list it as a processor in the terms.
**Edge cache (S8b):** the web app is served by Cloudflare, the origin only answers `/api`. The web image sets the TTLs
(bundles: `immutable`, one year; app shell: `Cloudflare-CDN-Cache-Control: max-age=3600`, browsers `no-cache`); two cache
rules make the shell eligible and bypass `/api`; the deploy purges the host (`ops/qa/purge-edge.sh`). Same setup in production.

## 3. Recommended: Raspberry Pi OS + Docker + deploy on push

The repo is public, so: arm64 images build on GitHub's free native arm64 runners, and **no self-hosted runner on the Pi**
(fork pull requests could run code on it).
- **Pi:** Raspberry Pi OS Lite 64-bit booting from the NVMe SSD; Docker Engine + compose plugin; `unattended-upgrades` for
  security patches; the repo's `docker-compose.yaml` + a `cloudflared` service (`TUNNEL_TOKEN`); `.env` only on the Pi.
- **Admin access:** Tailscale (no open ports, works behind CGNAT). Tailscale SSH for the founder and for deploys.
- **Pipeline** (on push to `main`, after `ci` and `backend` pass):
  1. build `ghcr.io/otaviojacobi/runflow:<sha>` on `ubuntu-24.04-arm` (+ `:main`), push to GHCR (public image, no secrets inside);
  2. deploy job (`environment: production`, push to `main` only, never on pull requests): join the tailnet with an
     ephemeral OAuth key (`tailscale/github-action`), `ssh pi ops/pi/deploy.sh <sha>`;
  3. `deploy.sh`: `git pull` (compose/ops changes), record the running tag, `RUNFLOW_TAG=<sha> docker compose pull && up -d`
     (the API migrates at start), wait for `/v1/health`; on failure, start the previous tag again and exit non-zero.
- **Rules this implies:** migrations stay compatible with the previous release (expand, then contract) so a rollback
  never meets a schema it can't read (from the beta on; until then data is disposable and the schema is one bootstrap migration that QA resets on, D-030); a deploy restarts the API (a few seconds of 502 through the tunnel; fine for the beta).
- **Fallback without Tailscale:** a systemd timer on the Pi runs `deploy.sh` every minute when `:main` on GHCR has a new
  digest (pull-based, zero inbound access, but no deploy logs in GitHub).

## 4. Alternative: balena

- balenaOS supports the Pi 5 (`raspberrypi5`). Boot from the NVMe SSD, not an SD card (§7.6): check the current balena docs for the Pi 5 NVMe setup.
- balena reads compose **2.4**: no `env_file`, `depends_on` only as a list (no `service_healthy`), healthchecks OK. So `ops/balena/docker-compose.yml` (S8) differs from the root one:
  - every `.env` key becomes a balenaCloud fleet/device variable (secrets never on disk in the repo or image);
  - `api` uses the published image `ghcr.io/otaviojacobi/runflow:<tag>` (arm64, built by CI); no on-device or balena-builder Rust compile;
  - `cloudflared` service: `cloudflare/cloudflared`, `command: tunnel --no-autoupdate run`, `TUNNEL_TOKEN` variable;
  - no published ports at all (cloudflared reaches `api` on the compose network);
  - `depends_on: [postgres]`: the API already retries the database for 30 s at start.
- Backups are still ours (S8): nightly `pg_dump`/base backup + WAL to off-site storage, monthly restore drill. balena does not back up volumes.
