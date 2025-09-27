# RTMP Streaming Service

## Overview

This is a 24/7 streaming service that streams video content from Dropbox to LiveKit using RTMP protocol. The service is built as a Node.js web application that manages FFmpeg processes to handle the video streaming pipeline. It provides REST API endpoints to control streaming operations and monitor stream status.

**Status**: ✅ Complete and fully functional - All FFmpeg errors resolved, ready for streaming configuration

## Recent Changes

- **2025-09-27**: **HARDWARE ACCELERATION ERRORS FIXED**: Resolved FFmpeg VAAPI crashes by disabling problematic hardware acceleration detection
- **2025-09-27**: **REPLIT IMPORT COMPLETE**: Successfully imported GitHub project and configured for Replit environment
- **2025-09-27**: ✅ FFmpeg system dependency installed and verified (v7.1.1)
- **2025-09-27**: ✅ Node.js dependencies installed without vulnerabilities 
- **2025-09-27**: ✅ Workflow "Streaming Service" configured and running on port 5000
- **2025-09-27**: ✅ Deployment configured for VM target (stateful streaming service)
- **2025-09-27**: ✅ API endpoints tested and verified working (/health, /stats, /, control endpoints)
- **2025-09-27**: ✅ Server properly binding to 0.0.0.0:5000 for external access in Replit environment
- **2025-09-26**: **REPLIT SETUP COMPLETE**: Successfully configured for Replit environment - FFmpeg installed, workflow configured, deployment ready
- **2025-09-26**: Configured Replit VM deployment for stateful streaming service with proper port 5000 binding
- **2025-09-26**: Installed system dependencies (FFmpeg) and Node.js dependencies for Replit environment
- **2025-09-26**: Set up workflow "Streaming Service" with npm start command for continuous operation
- **2025-09-26**: Verified API endpoints functioning correctly (/health, /stats, /, control endpoints)
- **2025-09-26**: **PRODUCTION-READY**: Comprehensive VPS streaming fixes - resolved all FFmpeg compatibility issues, implemented secure 24/7 streaming
- **2025-09-26**: Fixed FFmpeg "Option not found" errors by removing unsupported options (-reconnect_on_network_error, -reconnect_on_http_error, -rtmp_conn_timeout)
- **2025-09-26**: Enhanced VPS stability - Replaced -timeout with -rw_timeout and removed -stream_loop for HTTP sources (Dropbox compatibility)
- **2025-09-26**: Implemented intelligent EOF detection with proper fallback - only immediate restart for actual EOF, backoff for errors
- **2025-09-26**: Added rate limiting for EOF restarts (1s normal, 3s if frequent) to prevent source hammering on short files
- **2025-09-26**: Fixed critical security issues - masked stream key in all logs and enforced CONTROL_KEY authentication for endpoints
- **2025-09-26**: Enhanced port configuration - forced port 5000 in production to prevent VPS deployment mismatches
- **2025-09-26**: Implemented progressive backoff restart strategy with exponential delay increases and stability reset
- **2025-09-26**: Added comprehensive error diagnostics with FFmpeg exit code analysis and enhanced logging

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
3. FFmpeg process spawning with production-grade codec configuration (libx264/aac)
4. Continuous streaming with enhanced network resilience and RTMP-specific timeouts
5. Progressive backoff restart strategy with exponential delay increases
6. Comprehensive error detection, diagnostics, and status reporting
7. Exit code analysis and specific troubleshooting suggestions

### API Endpoints
- `GET /` - Service information and available endpoints
- `GET /health` - Stream status, uptime, errors, and process information
- `POST /start` - Manually start streaming
- `POST /stop` - Stop streaming
- `POST /restart` - Restart streaming

## External Dependencies

### Core Dependencies
- **Express.js**: Web framework for API server (configured for port 5000)
- **Node.js Child Process**: For FFmpeg process management with enhanced error handling
- **FFmpeg**: Production-grade video encoding with libx264/aac codecs for VPS stability

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

### Replit Deployment (Current Setup)
- **Status**: ✅ Ready for production deployment
- **Configuration**: VM deployment target for stateful streaming service
- **Port**: Configured for port 5000 with proper host binding (0.0.0.0)
- **Workflow**: "Streaming Service" configured with npm start command
- **Dependencies**: FFmpeg system dependency installed
- **Environment**: Requires secrets configuration via Replit Secrets for production use

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