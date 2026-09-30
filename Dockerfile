# syntax=docker/dockerfile:1
# ── Omni Agent — production image ─────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ── deps: install with build tools for native modules (better-sqlite3) ──
FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json tsconfig.build.json ./
COPY packages ./packages
COPY apps ./apps
COPY vitest.config.ts ./
RUN pnpm install --frozen-lockfile

# ── build: compile every package (tsc -b via turbo) ──
FROM deps AS build
RUN pnpm build

# ── runtime: only what is needed to run the gateway ──
FROM base AS runtime
ENV NODE_ENV=production
ENV OMNI_GATEWAY_HOST=0.0.0.0
ENV OMNI_GATEWAY_PORT=7800
COPY --from=build /app /app
EXPOSE 7800
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.OMNI_GATEWAY_PORT||7800)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/omni-gateway/dist/main.js"]
