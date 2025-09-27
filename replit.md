# RTMP Streaming Service

## Overview

This is a ultra-simplified 24/7 streaming service that streams video content directly from Dropbox to RTMP with maximum efficiency. Built as a single-process Node.js application with one direct FFmpeg stream - no HLS segmentation, no complex architecture, just pure efficiency focused on zero lag performance.

**Status**: ✅ Ultra-Simple & Mega-Efficient - Direct streaming with zero HLS complexity, optimized for maximum performance

## Recent Changes

- **2025-09-27**: **COMPLETE SIMPLIFICATION**: Eliminated all HLS segmentation complexity, removed multi-process architecture, implemented direct Dropbox→RTMP streaming with mega-efficient settings (160x120@3fps, 104k bitrate)
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

### Ultra-Simple Architecture
- **Framework**: Express.js web server with minimal REST API endpoints
- **Process Management**: Single FFmpeg process with direct Dropbox to RTMP streaming
- **Video Processing**: Ultra-efficient FFmpeg settings optimized for maximum performance
- **Configuration**: Environment variable-based secure configuration

### Core Components
- **Direct Stream**: One FFmpeg process handling entire Dropbox→RTMP pipeline
- **URL Converter**: Transforms Dropbox share URLs to direct download URLs (dl=0 → dl=1)  
- **Simple Monitor**: Basic streaming state tracking
- **Minimal API**: Essential endpoints only (start/stop/health)
- **Auto-restart Logic**: Automatic looping and restart on failures

### Design Patterns
- **Maximum Simplicity**: One direct FFmpeg process, no intermediate steps
- **Efficiency First**: All settings optimized for performance over quality
- **Zero Lag Focus**: Minimal buffering, ultra-low quality settings, frequent keyframes
- **Auto-Recovery**: Automatic restart and looping for 24/7 operation
- **Resource Minimal**: Tiny resolution (160x120), low framerate (3fps), ultra-low bitrate (104k total)

### Ultra-Efficient Streaming Pipeline
1. Environment variable validation (RTMP_URL, STREAM_KEY, VIDEO_URL)
2. Dropbox URL conversion from share links to direct download URLs  
3. Single FFmpeg process: Direct HTTP input → RTMP output (no HLS, no segmentation)
4. Ultra-efficient encoding: 160x120@3fps, CRF 40, 80k video + 24k audio
5. Zero-lag keyframes: Every 2 seconds for immediate viewer join
6. Automatic looping via reconnect_at_eof for continuous 24/7 streaming
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