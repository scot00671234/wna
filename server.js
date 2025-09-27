const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const StreamFetcher = require('./src/stream-fetcher');
const StreamPublisher = require('./src/stream-publisher');
const ContinuityController = require('./src/continuity-controller');

const app = express();
const PORT = (process.env.NODE_ENV === 'production') ? 5000 : (process.env.PORT || 5000);

// Multi-process streaming architecture components
let streamFetcher = null;
let streamPublisher = null;
let continuityCont = null;

// System state
let systemStatus = 'stopped';
let lastError = null;
let startTime = null;
let healthMonitor = null;

// ULTRA-OPTIMIZED configuration for lag-free 24/7 streaming
const config = {
    // Force tmpfs in production for zero disk I/O
    cacheDir: process.env.NODE_ENV === 'production' ? '/tmp/stream_cache' : 
              (process.env.USE_TMPFS === 'true' ? '/tmp/stream_cache' : './cache'),
    mediamtxHost: process.env.MEDIAMTX_HOST || 'localhost',
    segmentDuration: parseFloat(process.env.SEGMENT_DURATION) || 0.5, // 0.5s segments for ultra-low latency
    lookaheadSeconds: parseInt(process.env.LOOKAHEAD_SECONDS) || 10, // 10s lookahead for efficiency  
    maxCacheSize: parseInt(process.env.MAX_CACHE_SIZE) || 30, // 30s cache for minimal RAM
};

// Auto-detect hardware acceleration
if (!process.env.FFMPEG_HWACCEL) {
    // Try to detect available hardware acceleration
    const os = require('os');
    if (os.platform() === 'linux') {
        process.env.FFMPEG_HWACCEL = 'vaapi'; // Common on Linux VPS
    }
}

// Middleware
app.use(express.json());

// Convert Dropbox share URL to direct download URL
function convertDropboxUrl(shareUrl) {
    if (shareUrl.includes('/scl/fi/')) {
        return shareUrl.replace('?dl=0', '?dl=1').replace('&dl=0', '&dl=1');
    }
    return shareUrl.replace('?dl=0', '?dl=1');
}

// Initialize streaming system
async function initializeSystem() {
    try {
        console.log('🚀 Initializing Enhanced Streaming System...');
        
        const rtmpUrl = process.env.RTMP_URL;
        const streamKey = process.env.STREAM_KEY;
        const rawVideoUrl = process.env.VIDEO_URL;
        
        if (!rtmpUrl || !streamKey || !rawVideoUrl) {
            throw new Error('Missing required environment variables: RTMP_URL, STREAM_KEY, or VIDEO_URL');
        }
        
        const videoUrl = convertDropboxUrl(rawVideoUrl);
        
        // Create cache directory
        await fs.mkdir(config.cacheDir, { recursive: true });
        
        // Initialize Fetcher (downloads and segments video)
        streamFetcher = new StreamFetcher(videoUrl, config.cacheDir, {
            segmentDuration: config.segmentDuration,
            lookaheadSeconds: config.lookaheadSeconds,
            maxCacheSize: config.maxCacheSize
        });
        
        // Initialize Continuity Controller (manages playback position)
        continuityCont = new ContinuityController(config.cacheDir, streamFetcher, {
            segmentDuration: config.segmentDuration
        });
        
        // Configure publishing endpoints
        const endpoints = [
            {
                name: 'primary',
                url: `${rtmpUrl}/${streamKey}`,
                priority: 1,
                active: true
            }
        ];
        
        // Add backup endpoint if configured
        const backupRtmpUrl = process.env.BACKUP_RTMP_URL;
        const backupStreamKey = process.env.BACKUP_STREAM_KEY;
        if (backupRtmpUrl && backupStreamKey) {
            endpoints.push({
                name: 'backup',
                url: `${backupRtmpUrl}/${backupStreamKey}`,
                priority: 2,
                active: false // Start inactive, activate on primary failure
            });
        }
        
        // Initialize Publisher (manages RTMP connections)
        streamPublisher = new StreamPublisher(endpoints, {
            localRelayUrl: `rtmp://${config.mediamtxHost}:1935/live_relay`
        });
        
        console.log('✅ System components initialized');
        return true;
        
    } catch (error) {
        console.error('❌ System initialization failed:', error.message);
        lastError = error.message;
        return false;
    }
}

// Start the streaming system
async function startStreaming() {
    if (systemStatus === 'running') {
        console.log('⚠️  System already running');
        return { success: true, message: 'Already running' };
    }
    
    try {
        console.log('🎬 Starting enhanced streaming system...');
        systemStatus = 'starting';
        lastError = null;
        startTime = new Date();
        
        // Initialize system components if not done
        if (!streamFetcher) {
            const initialized = await initializeSystem();
            if (!initialized) {
                throw new Error('Failed to initialize system components');
            }
        }
        
        // Initialize all components
        await streamFetcher.initialize();
        await continuityCont.initialize();
        
        // Start fetcher (begins downloading and segmenting)
        await streamFetcher.start();
        console.log('✅ Stream fetcher started');
        
        // Wait for initial segments to be available
        console.log('⏳ Waiting for initial segments...');
        const hasSegments = await continuityCont.waitForSegments(3, 30000);
        if (!hasSegments) {
            throw new Error('Timeout waiting for initial segments');
        }
        
        // Generate initial playlist
        const playlistPath = await continuityCont.generatePlaylist();
        if (!playlistPath) {
            throw new Error('Failed to generate initial playlist');
        }
        console.log('✅ Initial playlist generated');
        
        // Start publisher (begins streaming to RTMP endpoints)
        await streamPublisher.start(playlistPath);
        console.log('✅ Stream publisher started');
        
        systemStatus = 'running';
        console.log('🎉 Enhanced streaming system fully operational!');
        
        // Start health monitoring
        startHealthMonitoring();
        
        return { success: true, message: 'Streaming started successfully' };
        
    } catch (error) {
        console.error('❌ Failed to start streaming:', error.message);
        systemStatus = 'error';
        lastError = error.message;
        
        // Cleanup on failure
        await stopStreaming();
        
        return { success: false, error: error.message };
    }
}

// Stop the streaming system
async function stopStreaming() {
    console.log('⏹️  Stopping enhanced streaming system...');
    systemStatus = 'stopping';
    
    // Stop health monitoring
    if (healthMonitor) {
        clearInterval(healthMonitor);
        healthMonitor = null;
    }
    
    // Stop all components
    if (streamPublisher) {
        await streamPublisher.stop();
    }
    
    if (streamFetcher) {
        await streamFetcher.stop();
    }
    
    systemStatus = 'stopped';
    startTime = null;
    console.log('✅ Streaming system stopped');
    
    return { success: true, message: 'Streaming stopped' };
}

// Restart the streaming system with continuity
async function restartStreaming() {
    console.log('🔄 Restarting streaming system with continuity...');
    
    // Stop publisher but keep fetcher running
    if (streamPublisher) {
        await streamPublisher.stop();
    }
    
    // Handle stream failure and resume from last position
    if (continuityCont) {
        await continuityCont.handleStreamFailure();
    }
    
    // Wait for segments and restart publisher
    const hasSegments = await continuityCont.waitForSegments(2, 15000);
    if (hasSegments) {
        const playlistPath = await continuityCont.updatePlaylist();
        if (playlistPath && streamPublisher) {
            await streamPublisher.start(playlistPath);
            console.log('✅ Streaming restarted with continuity');
            return { success: true, message: 'Restarted with continuity' };
        }
    }
    
    // Fallback to full restart
    console.log('⚠️  Continuity restart failed, performing full restart...');
    await stopStreaming();
    return await startStreaming();
}

// Health monitoring
function startHealthMonitoring() {
    console.log('🔍 Starting health monitoring...');
    
    healthMonitor = setInterval(async () => {
        try {
            if (systemStatus !== 'running') return;
            
            const fetcherStats = streamFetcher?.getStats();
            const publisherStats = streamPublisher?.getStats();
            const continuityStatus = continuityCont?.getStatus();
            
            // Check for critical issues
            const issues = [];
            
            // Check fetcher health
            if (!fetcherStats?.isRunning) {
                issues.push('Fetcher not running');
            } else if (fetcherStats.lookaheadSeconds < 10) {
                issues.push(`Low lookahead: ${fetcherStats.lookaheadSeconds}s`);
            }
            
            // Check publisher health
            if (!publisherStats?.isRunning) {
                issues.push('Publisher not running');
            } else if (publisherStats.stats.activeConnections === 0) {
                issues.push('No active RTMP connections');
            }
            
            // Auto-recovery actions
            if (issues.length > 0) {
                console.log(`⚠️  Health issues detected: ${issues.join(', ')}`);
                
                // Try continuity restart first
                if (publisherStats && !publisherStats.isRunning) {
                    console.log('🔄 Attempting continuity restart...');
                    await restartStreaming();
                }
                
                // Trigger quality fallback if primary connection issues persist
                if (publisherStats?.stats.reconnects > 5) {
                    console.log('⬇️  Multiple reconnects detected, triggering quality fallback...');
                    await streamPublisher.fallbackQuality();
                }
            } else {
                // System healthy - try to restore quality if using backup
                const activeBackup = publisherStats?.endpoints.find(e => e.name === 'backup' && e.connected);
                if (activeBackup) {
                    console.log('⬆️  System stable, attempting quality restoration...');
                    await streamPublisher.restoreQuality();
                }
            }
            
        } catch (error) {
            console.error('⚠️  Health monitoring error:', error.message);
        }
    }, 15000); // Check every 15 seconds
}

// Security middleware for control endpoints
function requireAuth(req, res, next) {
    const controlKey = process.env.CONTROL_KEY;
    if (!controlKey) {
        return res.status(403).json({ error: 'Control endpoints disabled - CONTROL_KEY not configured' });
    }
    if (req.headers['x-control-key'] !== controlKey) {
        return res.status(403).json({ error: 'Access denied - requires valid X-Control-Key header' });
    }
    next();
}

// API Routes
app.get('/health', (req, res) => {
    const uptime = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    
    const health = {
        status: systemStatus,
        uptime: uptime,
        lastError: lastError,
        timestamp: new Date().toISOString()
    };
    
    // Add component stats if available
    if (streamFetcher) {
        health.fetcher = streamFetcher.getStats();
    }
    
    if (streamPublisher) {
        health.publisher = streamPublisher.getStats();
    }
    
    if (continuityCont) {
        health.continuity = continuityCont.getStatus();
    }
    
    res.json(health);
});

app.get('/stats', (req, res) => {
    const stats = {
        system: {
            status: systemStatus,
            uptime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
            lastError: lastError
        }
    };
    
    if (streamFetcher) {
        stats.fetcher = streamFetcher.getStats();
    }
    
    if (streamPublisher) {
        stats.publisher = streamPublisher.getStats();
    }
    
    if (continuityCont) {
        stats.continuity = continuityCont.getStatus();
    }
    
    res.json(stats);
});

app.post('/start', requireAuth, async (req, res) => {
    const result = await startStreaming();
    res.json(result);
});

app.post('/stop', requireAuth, async (req, res) => {
    const result = await stopStreaming();
    res.json(result);
});

app.post('/restart', requireAuth, async (req, res) => {
    const result = await restartStreaming();
    res.json(result);
});

app.post('/seek/:segment', requireAuth, async (req, res) => {
    const segmentId = parseInt(req.params.segment);
    
    if (!continuityCont) {
        return res.status(400).json({ error: 'Continuity controller not initialized' });
    }
    
    const success = await continuityCont.seekTo(segmentId);
    res.json({ 
        success, 
        message: success ? `Seeked to segment ${segmentId}` : 'Seek failed',
        currentPosition: continuityCont.getCurrentPosition()
    });
});

app.post('/quality/fallback', requireAuth, async (req, res) => {
    if (!streamPublisher) {
        return res.status(400).json({ error: 'Publisher not initialized' });
    }
    
    await streamPublisher.fallbackQuality();
    res.json({ success: true, message: 'Quality fallback triggered' });
});

app.post('/quality/restore', requireAuth, async (req, res) => {
    if (!streamPublisher) {
        return res.status(400).json({ error: 'Publisher not initialized' });
    }
    
    await streamPublisher.restoreQuality();
    res.json({ success: true, message: 'Quality restoration attempted' });
});

app.get('/', (req, res) => {
    res.json({
        service: 'Enhanced RTMP Streaming Service',
        version: '2.0.0',
        architecture: 'Multi-Process with Local Relay',
        status: systemStatus,
        features: [
            'Segmented video caching with prefetch',
            'Stream continuity and resume from position',
            'Multi-endpoint publishing with fallback',
            'Quality adaptation and network resilience',
            'Local RTMP relay for decoupled streaming',
            'Health monitoring and auto-recovery'
        ],
        endpoints: {
            health: '/health - System health and stats',
            stats: '/stats - Detailed component statistics',
            start: '/start (POST) - Start streaming system',
            stop: '/stop (POST) - Stop streaming system',  
            restart: '/restart (POST) - Restart with continuity',
            seek: '/seek/:segment (POST) - Seek to specific segment',
            quality: {
                fallback: '/quality/fallback (POST) - Trigger quality fallback',
                restore: '/quality/restore (POST) - Restore primary quality'
            }
        }
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down...');
    await stopStreaming();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down...');
    await stopStreaming();
    process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Enhanced RTMP Streaming Service v2.0 running on port ${PORT}`);
    console.log(`🌐 Server binding to 0.0.0.0:${PORT} for external access`);
    console.log(`🏗️  Architecture: Multi-Process with Local Relay (MediaMTX)`);
    
    console.log('Environment check:');
    console.log(`- PORT: ${PORT} (${process.env.PORT ? 'from env' : 'default'})`);
    console.log(`- RTMP_URL: ${process.env.RTMP_URL ? '✅ Set' : '❌ Missing'}`);
    console.log(`- STREAM_KEY: ${process.env.STREAM_KEY ? '✅ Set' : '❌ Missing'}`);
    console.log(`- VIDEO_URL: ${process.env.VIDEO_URL ? '✅ Set' : '❌ Missing'}`);
    console.log(`- BACKUP_RTMP_URL: ${process.env.BACKUP_RTMP_URL ? '✅ Set' : '➖ Optional'}`);
    console.log(`- CONTROL_KEY: ${process.env.CONTROL_KEY ? '✅ Set' : '❌ Missing'}`);
    console.log(`- CACHE_DIR: ${config.cacheDir} (${config.cacheDir.includes('/tmp/') ? 'tmpfs/RAM' : 'disk'})`);
    console.log(`- FFMPEG_HWACCEL: ${process.env.FFMPEG_HWACCEL || 'software only'}`);
    console.log(`- SEGMENT_DURATION: ${config.segmentDuration}s (ultra-low latency)`);
    console.log(`- LOOKAHEAD: ${config.lookaheadSeconds}s (minimal)`);
    console.log(`- MAX_CACHE: ${config.maxCacheSize}s (minimal RAM usage)`);
    
    // Auto-start streaming after 5 seconds to allow system stabilization
    console.log('Auto-starting optimized streaming system in 5 seconds...');
    setTimeout(async () => {
        console.log('🎬 Initializing optimized streaming system...');
        await startStreaming();
    }, 5000);
});