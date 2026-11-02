# Hosting: Pi 5 on balena + Cloudflare Tunnel (S8 plan)

Founder is considering balenaCloud to manage the Raspberry Pi 5, with `cloudflared` in the same compose.
This file is the checklist; decisions go to root.md §9 when made.

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

## 3. balena

- balenaOS supports the Pi 5 (`raspberrypi5`). Boot from the NVMe SSD, not an SD card (§7.6): check the current balena docs for the Pi 5 NVMe setup.
- balena reads compose **2.4**: no `env_file`, `depends_on` only as a list (no `service_healthy`), healthchecks OK. So `ops/balena/docker-compose.yml` (S8) differs from the root one:
  - every `.env` key becomes a balenaCloud fleet/device variable (secrets never on disk in the repo or image);
  - `api` uses the published image `ghcr.io/otaviojacobi/runflow:<tag>` (arm64, built by CI); no on-device or balena-builder Rust compile;
  - `cloudflared` service: `cloudflare/cloudflared`, `command: tunnel --no-autoupdate run`, `TUNNEL_TOKEN` variable;
  - no published ports at all (cloudflared reaches `api` on the compose network);
  - `depends_on: [postgres]`: the API already retries the database for 30 s at start.
- Backups are still ours (S8): nightly `pg_dump`/base backup + WAL to off-site storage, monthly restore drill. balena does not back up volumes.
