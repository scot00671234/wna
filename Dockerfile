FROM node:18-alpine

# Install system dependencies in one layer
RUN apk add --no-cache \
    ffmpeg \
    wget \
    tini \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S streaming -u 1001 -G nodejs

# Create app directory with proper permissions
WORKDIR /app
RUN chown -R streaming:nodejs /app

# Copy package files and install dependencies as non-root
COPY --chown=streaming:nodejs package*.json ./
USER streaming
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY --chown=streaming:nodejs . .

# Create cache directory with proper permissions
RUN mkdir -p /app/cache && chmod 755 /app/cache

# Expose port
EXPOSE 5000

# Enhanced health check for pump.fun streaming
HEALTHCHECK --interval=30s --timeout=15s --start-period=90s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider --timeout=10 http://localhost:5000/health || exit 1

# Use tini for proper signal handling and run as non-root
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]