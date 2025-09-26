FROM node:18-alpine

# Install FFmpeg and wget for healthchecks
RUN apk add --no-cache ffmpeg wget

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create cache directory
RUN mkdir -p /usr/src/app/cache

# Expose port
EXPOSE 5000

# Enhanced health check for multi-component system
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider --timeout=10 http://localhost:5000/health || exit 1

# Start the application
CMD ["node", "server.js"]