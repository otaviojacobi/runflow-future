# syntax=docker/dockerfile:1.7
# Runflow API image: one binary (`runflow all | serve | migrate | doctor | email-test | healthcheck`).
# Multi-arch (Pi = arm64): docker buildx build --platform linux/amd64,linux/arm64 backend
# Each platform builds natively (QEMU when emulated); no cross toolchain needed.

ARG RUST_VERSION=1.99
ARG DEBIAN=trixie

FROM rust:${RUST_VERSION}-slim-${DEBIAN} AS build
WORKDIR /src
# aws-lc (TLS for Postgres and HTTPS calls) builds with a C compiler and cmake.
RUN apt-get update && apt-get install -y --no-install-recommends cmake clang && rm -rf /var/lib/apt/lists/*
COPY . .
ARG RUNFLOW_GIT_SHA=""
ARG RUNFLOW_VERSION=""
ENV RUNFLOW_GIT_SHA=${RUNFLOW_GIT_SHA} RUNFLOW_VERSION=${RUNFLOW_VERSION} SQLX_OFFLINE=true
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/src/target,sharing=locked \
    cargo build --release --locked --bin runflow \
 && cp target/release/runflow /runflow

FROM debian:${DEBIAN}-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin runflow \
 && mkdir -p /data/uploads && chown runflow:runflow /data/uploads
COPY --from=build /runflow /usr/local/bin/runflow
USER runflow
ENV HOST=0.0.0.0 PORT=3000 LOG_FORMAT=json STORAGE_DIR=/data/uploads
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/runflow"]
CMD ["all"]
