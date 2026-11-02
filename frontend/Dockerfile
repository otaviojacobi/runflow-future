# syntax=docker/dockerfile:1.7
# Runflow web app for QA/production: the static build served by Caddy, with /api proxied to the API
# container (same origin, so no CORS and cookies just work). Build context: the repo root.
#   docker build -f frontend/Dockerfile -t runflow-web .

FROM node:24-alpine AS build
WORKDIR /src
# Workspace manifests first (npm needs every workspace's package.json to read the lockfile).
COPY package.json package-lock.json ./
COPY design/package.json design/package.json
COPY frontend/package.json frontend/package.json
COPY mobile/package.json mobile/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --workspace @runflow/frontend --include-workspace-root=false --no-audit --no-fund
COPY design design
COPY frontend frontend
# /dev/status renders the build plan.
COPY docs/build-plan.md docs/build-plan.md
# Talk to the real backend (not the mock).
ENV VITE_MOCK=false
RUN npm run build -w @runflow/frontend

FROM caddy:2-alpine
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/frontend/dist /srv
EXPOSE 80
