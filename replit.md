# Ultra-Lightweight Audio Streaming Service

## Overview

This is a ultra-lightweight 24/7 audio streaming service that streams MP3 audio content from Dropbox combined with a static HD image to RTMP destinations. Built as a single-process Node.js application optimized for audiobook streaming with zero lag performance and minimal resource usage.

**Status**: ✅ Ultra-Lightweight & Zero-Lag - MP3 audio + static image streaming optimized for audiobook content

## Recent Changes

- **2025-09-27**: **AUDIO STREAMING CONVERSION**: Converted from video to ultra-lightweight audio streaming - MP3 from Dropbox + static HD cover image (1280x720@1fps, 178k bitrate) for zero lag audiobook streaming
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

### Ultra-Lightweight Architecture
- **Framework**: Express.js web server with minimal REST API endpoints
- **Process Management**: Single FFmpeg process combining static image + MP3 audio
- **Audio Processing**: High-quality MP3 streaming from Dropbox with static HD cover image
- **Configuration**: Environment variable-based secure configuration

### Core Components
- **Audio Stream**: One FFmpeg process combining static image + MP3 audio from Dropbox
- **Static Image**: HD cover image (1280x720) for visual component with minimal bitrate
- **URL Converter**: Transforms Dropbox share URLs to direct download URLs (dl=0 → dl=1)  
- **Simple Monitor**: Basic streaming state tracking
- **Minimal API**: Essential endpoints only (start/stop/health)
- **Auto-restart Logic**: Automatic looping and restart on audio completion

### Design Patterns
- **Zero Lag Audio**: MP3 audio streaming with static image for instant playback
- **Quality Focus**: High-quality audio (128k stereo) for audiobook content
- **Minimal Video**: Static HD image at 1fps with minimal bitrate (50k)
- **Auto-Recovery**: Automatic restart and looping for 24/7 operation
- **Resource Efficient**: Static image + audio streaming (178k total bitrate)

### Ultra-Lightweight Streaming Pipeline
1. Environment variable validation (RTMP_URL, STREAM_KEY, AUDIO_URL)
2. Dropbox URL conversion from share links to direct download URLs  
3. Single FFmpeg process: Static image + MP3 audio → RTMP output
4. Efficient encoding: 1280x720@1fps static image (50k) + 128k stereo audio
5. Minimal keyframes: Every 30 seconds since image is static
6. Automatic looping via reconnect_at_eof for continuous 24/7 audiobook streaming
7. Simple restart logic with minimal delay

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
- `RTMP_URL`: Base RTMP server URL for streaming destination
- `STREAM_KEY`: Authentication key for RTMP streaming
- `AUDIO_URL`: Dropbox share URL for source MP3 audio content
- `CONTROL_KEY`: Authentication key for control endpoints (optional)
- `PORT`: Server port configuration (optional, defaults to 5000)

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
├── server.js           # Main audio streaming service
├── package.json        # Node.js dependencies  
├── assets/             # Static assets
│   └── cover.png       # HD audiobook cover (1280x720)
├── Dockerfile          # Production container
├── docker-compose.yml  # Deployment configuration
├── .dockerignore       # Exclude unnecessary files
└── replit.md          # Project documentation
```