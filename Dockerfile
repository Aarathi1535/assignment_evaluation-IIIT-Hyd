# ==========================================
# Stage 1: Base Runtime Environment
# ==========================================
FROM node:20-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Install essential runtime utilities, system fonts for canvas rendering, and CA certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    fontconfig \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# ==========================================
# Stage 2: Dependencies Installation
# ==========================================
FROM base AS deps
WORKDIR /app
ENV NODE_ENV=development

# Install dependencies based on package-lock.json
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts || npm install

# ==========================================
# Stage 3: Application Build
# ==========================================
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Provide build-time fallback configuration for Next.js build compilation
ENV MONGODB_URI="mongodb://localhost:27017/build_db"
ENV NEXTAUTH_SECRET="build-time-secret-at-least-32-chars-long!"
ENV NEXTAUTH_URL="http://localhost:3000"
ENV ORIGINAL_STORAGE_HMAC_SECRET="build-time-hmac-secret-at-least-32-chars-long!"

RUN npm run build

# ==========================================
# Stage 4: Production Runtime Runner
# ==========================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

# Create unprivileged application user and group
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 nextjs -g nodejs

# Create persistent storage directories and assign permissions to nextjs user
RUN mkdir -p /app/data/originals /app/data/derived && \
    chown -R nextjs:nodejs /app/data

# Copy built application assets and production runtime dependencies
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/next.config.ts ./next.config.ts

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["npm", "start"]
