# syntax=docker/dockerfile:1.7
# Production images for api, web and migrate (infrastructure/03 §2). Built from the repo root for linux/arm64:
#   docker buildx build --platform linux/arm64 --target api .
# Images run as non-root on distroless Node 22 and trust the Amazon RDS CA bundle for TLS to Aurora.

ARG NODE_IMAGE=node:22-slim
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian13:nonroot

# --- Install and build ------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# Manifests first so the dependency layer is cached until a lockfile or package.json changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY tools/package.json tools/
COPY modules modules
COPY packages packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter '@archova/api...' --filter '@archova/web...' --filter '@archova/tools' --filter archova

COPY . .
RUN pnpm turbo run build --filter=@archova/api --filter=@archova/web \
 && pnpm --filter @archova/tools exec node db/build.mjs

# The packages left outside the bundle (apps/api/build.mjs), at the versions the lockfile resolved.
WORKDIR /out/api
RUN ARGON2=$(node -p "require('/repo/apps/api/node_modules/@node-rs/argon2/package.json').version") \
 && PDFJS=$(node -p "require('/repo/modules/ai/node_modules/pdfjs-dist/package.json').version") \
 && echo '{"name":"api-runtime","private":true,"type":"module"}' > package.json \
 && npm install --omit=dev --no-audit --no-fund "@node-rs/argon2@${ARGON2}" "pdfjs-dist@${PDFJS}" \
 && cp -r /repo/apps/api/dist ./dist

ADD --checksum=sha256:fe45bbebf92ad3e27a583bbb2ddd1553c521ed4d49af5514dc0a40372ea5395c \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /out/rds-ca.pem

# --- api ----------------------------------------------------------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS api
WORKDIR /app
ENV NODE_ENV=production NODE_EXTRA_CA_CERTS=/etc/ssl/rds-ca.pem
COPY --from=build /out/rds-ca.pem /etc/ssl/rds-ca.pem
COPY --from=build /out/api /app
EXPOSE 4000
CMD ["--enable-source-maps", "dist/server.js"]

# --- web (Next.js standalone) -------------------------------------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /repo/apps/web/.next/standalone /app
COPY --from=build /repo/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build /repo/apps/web/public /app/apps/web/public
EXPOSE 3000
CMD ["apps/web/server.js"]

# --- migrate (one-off ECS tasks: tools/db/migrate.js as app_migrator; tools/db/roles.js as the master user) ------
FROM ${RUNTIME_IMAGE} AS migrate
WORKDIR /app
ENV NODE_ENV=production NODE_EXTRA_CA_CERTS=/etc/ssl/rds-ca.pem
COPY --from=build /out/rds-ca.pem /etc/ssl/rds-ca.pem
COPY --from=build /repo/tools/db/dist/migrate.js /repo/tools/db/dist/migrate.js.map /repo/tools/db/dist/roles.js /repo/tools/db/dist/roles.js.map /app/tools/db/
COPY --from=build /repo/db/migrations /app/db/migrations
CMD ["--enable-source-maps", "tools/db/migrate.js"]

# --- laptop demo tools (docker-compose.demo.yml only; never deployed) ---------------------------------------------
# The build stage with the repo and its dev tools: sets up the local database and loads the sample data.
FROM build AS demo-tools
WORKDIR /repo
ENTRYPOINT ["pnpm"]
