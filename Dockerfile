# Stage 1: Build Frontend Client
FROM node:20-slim AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build Backend Server & Pre-seed Database
FROM node:20 AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
ENV DATABASE_URL="file:/app/server/prisma/dev.db"
RUN npx prisma generate
RUN npx prisma db push --accept-data-loss
RUN npx tsx src/db/seed.ts
RUN npm run build

# Stage 3: Production Runner
FROM node:20 AS runner
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

# Pre-populate SQLite database with migrated and seeded dev.db
COPY --from=server-builder /app/server/prisma/dev.db /app/storage/dev.db

EXPOSE 4000

CMD ["node", "server/dist/index.js"]
