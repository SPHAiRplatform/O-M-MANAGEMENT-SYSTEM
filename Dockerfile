# Multi-stage Dockerfile for SPHAiRDigital
# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./
RUN npm ci

# Copy client source
COPY client/ ./

# Build frontend
RUN npm run build

# Stage 2: Production runtime
FROM node:18-alpine

WORKDIR /app

# Install production dependencies only
COPY server/package*.json ./
RUN npm ci --only=production

# Copy server source
COPY server/ ./

# Copy built frontend from builder stage
COPY --from=frontend-builder /app/client/build ./public

# Create necessary directories
RUN mkdir -p uploads/profiles logs backups

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/platform/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "index.js"]
