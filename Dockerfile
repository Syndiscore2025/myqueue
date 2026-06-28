# syntax=docker/dockerfile:1

# =============================================================================
# MyQueue production image (multi-stage)
# =============================================================================

# ----- Base ------------------------------------------------------------------
FROM node:22-slim AS base
ENV NODE_ENV=production
WORKDIR /app
# Prisma requires OpenSSL at build and runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ----- Dependencies (with dev) for building ----------------------------------
FROM base AS deps
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Installs all deps; postinstall runs `prisma generate`.
RUN npm ci

# ----- Build -----------------------------------------------------------------
FROM deps AS build
ENV NODE_ENV=development
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ----- Migrate ----------------------------------------------------------------
# A thin stage that ships the Prisma CLI + schema + migrations so an orchestrator
# can apply `prisma migrate deploy` against the database before the app starts.
# It reuses the `deps` layer (which already has the CLI and the generated client)
# rather than the slim runtime, which omits the CLI by design.
FROM deps AS migrate
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "prisma:migrate"]

# ----- Production runtime -----------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
# Install production deps only; skip lifecycle scripts (no prisma CLI here).
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

# Bring in the generated Prisma client and compiled output from the build stage.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist

# Run as the built-in unprivileged user.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
