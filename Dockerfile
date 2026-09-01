# syntax=docker/dockerfile:1.7

##############################################################################
# Build stage — full toolchain, dev dependencies, produces dist/standalone/
##############################################################################
FROM node:22-alpine AS build

WORKDIR /app

# Corepack prompts before downloading a package manager; that would hang a
# non-interactive build. The pinned pnpm comes from package.json#packageManager.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Dependency layer: only re-runs when the manifests change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Application sources.
COPY . .

# DEPLOY_TARGET=node (the vite.config.ts default) plus `output: 'standalone'`
# in next.config.ts emits a self-contained Node bundle at dist/standalone/:
#   server.js + dist/{client,server} + public/ + node_modules (runtime deps only)
ENV NODE_ENV=production
RUN pnpm build

# Fail the build loudly here rather than at container start if the standalone
# bundle was not produced.
RUN test -f dist/standalone/server.js \
  || (echo "ERROR: dist/standalone/server.js missing. Is output:'standalone' still set in next.config.ts?" && exit 1)

##############################################################################
# Runtime stage — just Node, tini and the standalone bundle
##############################################################################
FROM node:22-alpine AS runtime

# Image provenance. Set by CI; makes GHCR link the package to the repository.
ARG IMAGE_SOURCE="https://github.com/J1-HyPz/parlay-projector"
ARG IMAGE_REVISION="unknown"
LABEL org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}" \
      org.opencontainers.image.title="Parlay Projector" \
      org.opencontainers.image.description="Parlay Projector by HyPz — multi-sport analytics interface" \
      org.opencontainers.image.licenses="UNLICENSED"

# tini reaps zombies and forwards SIGTERM, so `docker stop` shuts down cleanly
# regardless of whether the orchestrator supplies its own init.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# The standalone bundle is the entire application. No package manager, no dev
# dependencies, no source tree, no volume mount required at runtime.
COPY --from=build --chown=node:node /app/dist/standalone ./

# node:alpine ships an unprivileged `node` user (uid 1000).
USER node

EXPOSE 3000

# Uses Node's global fetch, so the image needs no curl/wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
