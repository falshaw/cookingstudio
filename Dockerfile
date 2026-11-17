FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS base
RUN apk upgrade --no-cache

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
ARG DATABASE_URL="prisma://build-placeholder"
ARG JWT_SECRET="build-placeholder-secret-min-32-chars-long"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 -G nodejs nextjs && \
    apk add --no-cache poppler-utils=25.12.0-r1 && \
    mkdir -p /data/images && chown -R nextjs:nodejs /data

COPY --from=builder /app/public ./public
# Recipe / step / ingredient / technique pictures that ship with the repo (served by /api/images/[id]).
COPY --from=builder /app/prisma/seed-images ./prisma/seed-images
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# poppler-utils = pdftotext for the lab-report PDF import (runs locally, nothing leaves the box).
# Pinned to the Alpine 3.22 (node:24.22.3-alpine) package version — bump it with the base image.

# Defense-in-depth: remove any .env leaked into standalone output
RUN rm -f .env .env.*

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
