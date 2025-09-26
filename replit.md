# RTMP Streaming Service

## Overview

This is a 24/7 streaming service that streams video content from Dropbox to LiveKit using RTMP protocol. The service is built as a Node.js web application that manages FFmpeg processes to handle the video streaming pipeline. It provides REST API endpoints to control streaming operations and monitor stream status.

**Status**: ✅ Complete and fully functional - streaming verified working to LiveKit RTMP endpoint

## Recent Changes

- **2025-09-26**: Created complete 24/7 streaming service with auto-restart functionality
- **2025-09-26**: Fixed critical error handling to prevent crashes on missing environment variables
- **2025-09-26**: Verified streaming pipeline works correctly with Dropbox URL conversion
- **2025-09-26**: Added Docker setup for VPS deployment via Dokploy

## User Preferences

Preferred communication style: Simple, everyday language.
Project requirement: Lightweight GitHub-compatible codebase (no large video files stored locally)

## System Architecture

### Backend Architecture
- **Framework**: Express.js web server providing REST API endpoints
- **Process Management**: Child process spawning to manage FFmpeg streaming instances
- **Video Processing**: FFmpeg for video transcoding and RTMP streaming
- **Configuration**: Environment variable-based secure configuration

### Core Components
- **Stream Controller**: Manages FFmpeg process lifecycle (start/stop/monitor)
- **URL Converter**: Transforms Dropbox share URLs to direct download URLs (dl=0 → dl=1)
- **Status Monitor**: Tracks streaming state, uptime, and error conditions
- **API Layer**: REST endpoints for stream control and status reporting
- **Auto-restart Logic**: Automatically restarts streaming on FFmpeg failures

### Design Patterns
- **Single Process Model**: One active FFmpeg stream process at a time
- **Stateful Service**: Maintains stream status, error states, and timing information
- **Environment-driven Configuration**: All sensitive data and URLs configured via secure environment variables
- **Process Monitoring**: Real-time tracking of stream health and automatic error handling
- **Graceful Error Handling**: Proper validation prevents crashes on missing configuration

### Video Streaming Pipeline
1. Environment variable validation (RTMP_URL, STREAM_KEY, VIDEO_URL)
2. Dropbox URL conversion from share links to direct download URLs
3. FFmpeg process spawning with configured RTMP output and infinite loop
4. Continuous streaming with process monitoring and auto-restart
5. Error detection, logging, and status reporting

### API Endpoints
- `GET /` - Service information and available endpoints
- `GET /health` - Stream status, uptime, errors, and process information
- `POST /start` - Manually start streaming
- `POST /stop` - Stop streaming
- `POST /restart` - Restart streaming

## External Dependencies

### Core Dependencies
- **Express.js**: Web framework for API server
- **Node.js Child Process**: For FFmpeg process management

### External Services
- **Dropbox**: Video file hosting and content source (no local storage)
- **LiveKit**: RTMP streaming destination platform
- **FFmpeg**: Video processing and streaming engine (system dependency)

### Required Environment Variables
- `RTMP_URL`: Base RTMP server URL for LiveKit (rtmps://pump-prod-tg2x8veh.rtmp.livekit.cloud/x)
- `STREAM_KEY`: Authentication key for RTMP streaming
- `VIDEO_URL`: Dropbox share URL for source video content
- `PORT`: Server port configuration (optional, defaults to 3000)

### System Requirements
- Node.js 18.0.0 or higher
- FFmpeg installed on the system
- Network connectivity for Dropbox and LiveKit services

## Deployment

### Docker Deployment (VPS/Dokploy)
- `Dockerfile` - Production-ready container with FFmpeg
- `docker-compose.yml` - Complete deployment configuration
- Health checks and restart policies configured
- Environment variables injected at runtime
- Lightweight build (no large files in image)

### File Structure
```
.
├── server.js           # Main streaming service
├── package.json        # Node.js dependencies
├── Dockerfile          # Production container
├── docker-compose.yml  # Deployment configuration
├── .dockerignore       # Exclude unnecessary files
└── replit.md          # Project documentation
```