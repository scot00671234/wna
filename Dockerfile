FROM node:18-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { \
      host: 'localhost', \
      port: 5000, \
      path: '/health', \
      timeout: 2000 \
    }; \
    const request = http.request(options, (res) => { \
      if (res.statusCode === 200) { \
        console.log('Health check passed'); \
        process.exit(0); \
      } else { \
        console.log('Health check failed'); \
        process.exit(1); \
      } \
    }); \
    request.on('error', () => { \
      console.log('Health check error'); \
      process.exit(1); \
    }); \
    request.end();"

# Start the application
CMD ["npm", "start"]