# Stage 1: Build Frontend Client
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build Backend Server
FROM node:20-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate
RUN npm run build

# Stage 3: Production Runner
FROM node:20-alpine AS runner
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

CMD ["sh", "-c", "cd server && npx prisma db push && node dist/index.js"]
