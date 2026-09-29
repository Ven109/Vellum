# syntax=docker/dockerfile:1
# Vellum server image: the sync/API server with the web app built in.

FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/editor/package.json packages/editor/
COPY packages/ai/package.json packages/ai/
# Behind a TLS-inspecting proxy, pass its CA: docker build --secret id=ca_bundle,src=/path/to/ca.pem .
RUN --mount=type=secret,id=ca_bundle,required=false \
    if [ -f /run/secrets/ca_bundle ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle; fi; \
    pnpm install --frozen-lockfile --filter @vellum/server... --filter @vellum/web...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @vellum/web build && pnpm --filter @vellum/server build

FROM node:22-bookworm-slim
ARG VELLUM_VERSION=dev
ENV VELLUM_VERSION=${VELLUM_VERSION} \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    VELLUM_DATA_DIR=/data \
    VELLUM_WEB_DIST=/app/web
WORKDIR /app
COPY --from=build /src/apps/server/dist /app/server
COPY --from=build /src/apps/web/dist /app/web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "/app/server/main.js"]
