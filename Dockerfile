# Stage 1: Build Frontend Client
FROM node:20-slim AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build Backend Server
FROM node:20-slim AS server-builder
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate
RUN npm run build

# Stage 3: Production Runner
FROM node:20-slim AS runner
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_URL="file:/app/storage/dev.db"
ENV STORAGE_DIR="/app/storage"
ENV TEMPLATES_DIR="/app/templates"

# Copy server production dependencies & built code
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=server-builder /app/server/prisma ./server/prisma
COPY --from=server-builder /app/server/node_modules/.prisma ./server/node_modules/.prisma
COPY --from=server-builder /app/server/node_modules/@prisma ./server/node_modules/@prisma

# Copy built frontend assets
COPY --from=client-builder /app/client/dist ./client/dist

# Copy templates and initial storage folders
COPY templates/ ./templates/
RUN mkdir -p /app/storage/documents /app/storage/photos /app/storage/reports

EXPOSE 4000

CMD ["sh", "-c", "cd server && npx prisma db push --skip-generate --accept-data-loss && node dist/index.js"]
