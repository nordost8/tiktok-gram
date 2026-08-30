# Production Next.js for Raspberry Pi (standalone output).
# Builder runs on the CI runner's native platform (AMD64) — no QEMU overhead.
# Next.js output is pure JS so it runs on ARM64 without recompilation.
# Builder on the CI host (AMD64) — Next.js output is portable JS for ARM64 runners.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.19.0 --activate

COPY . .

ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true

ARG POSTGRES_URL="postgresql://postgres:password@localhost:5432/tiktok_gram"
ENV POSTGRES_URL=${POSTGRES_URL}

RUN pnpm install --frozen-lockfile
RUN pnpm -F @tiktok-gram/nextjs build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/nextjs/public ./apps/nextjs/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/nextjs/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/nextjs/.next/static ./apps/nextjs/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "apps/nextjs/server.js"]
