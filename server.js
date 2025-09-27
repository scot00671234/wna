const express = require('express');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 5000;

// Simple state tracking
let streamProcess = null;
let isStreaming = false;
let startTime = null;
let lastError = null;

// Middleware
app.use(express.json());

// Convert Dropbox share URL to direct download URL
function convertDropboxUrl(shareUrl) {
    if (shareUrl.includes('/scl/fi/')) {
        return shareUrl.replace('?dl=0', '?dl=1').replace('&dl=0', '&dl=1');
    }
    return shareUrl.replace('?dl=0', '?dl=1');
}

// Start direct streaming - MEGA SIMPLE & EFFICIENT
async function startStreaming() {
    if (isStreaming) {
        console.log('⚠️  Already streaming');
        return { success: true, message: 'Already streaming' };
    }

    try {
        const rtmpUrl = process.env.RTMP_URL;
        const streamKey = process.env.STREAM_KEY;
        const rawVideoUrl = process.env.VIDEO_URL;
        
        if (!rtmpUrl || !streamKey || !rawVideoUrl) {
            throw new Error('Missing required environment variables: RTMP_URL, STREAM_KEY, or VIDEO_URL');
        }

        const videoUrl = convertDropboxUrl(rawVideoUrl);
        const fullRtmpUrl = `${rtmpUrl}/${streamKey}`;

        console.log('🎬 Starting DIRECT streaming (no HLS, no segmentation)...');
        console.log('🎯 MAX EFFICIENCY MODE - Lowest possible quality for zero lag');
        
        // ULTRA-SIMPLE direct stream: Dropbox -> RTMP (no intermediate steps)
        const ffmpegArgs = [
            '-hide_banner',
            '-loglevel', 'error', // Only show actual errors
            '-re', // Real-time streaming
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '10',
            '-reconnect_at_eof', '1', // Reconnect when video ends (for looping)
            '-i', videoUrl,
            
            // MEGA EFFICIENT SETTINGS - Absolute minimum quality for maximum performance
            '-c:v', 'libx264',
            '-preset', 'ultrafast', // Fastest possible encoding
            '-tune', 'zerolatency', // Zero latency tuning
            '-crf', '40', // Very high CRF = very low quality = maximum efficiency
            '-maxrate', '80k', // Even lower bitrate for maximum efficiency
            '-bufsize', '160k',
            '-s', '160x120', // Even tinier resolution for max efficiency
            '-r', '3', // Very low framerate (3 fps)
            '-pix_fmt', 'yuv420p',
            
            // ZERO-LAG KEYFRAME SETTINGS - Prevents long join times
            '-g', '6', // GOP size: keyframe every 2 seconds (6 frames at 3fps)
            '-keyint_min', '6',
            '-sc_threshold', '0', // Disable scene change detection
            '-force_key_frames', 'expr:gte(t,n_forced*2)', // Force keyframe every 2 seconds
            
            // MINIMAL AUDIO
            '-c:a', 'aac',
            '-b:a', '24k', // Ultra low audio bitrate
            '-ar', '16000', // Low sample rate
            '-ac', '1', // Mono audio
            
            // DIRECT RTMP OUTPUT
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
            fullRtmpUrl
        ];

        console.log('🚀 Direct stream command:');
        console.log(`ffmpeg ${ffmpegArgs.join(' ')}`);

        streamProcess = spawn('ffmpeg', ffmpegArgs);
        isStreaming = true;
        startTime = new Date();
        lastError = null;

        streamProcess.stdout.on('data', (data) => {
            // Minimal output
        });

        streamProcess.stderr.on('data', (data) => {
            const output = data.toString();
            // Only log actual errors
            if (output.includes('error') || output.includes('failed')) {
                console.log(`❌ Stream error: ${output.trim()}`);
                lastError = output.trim();
            }
        });

        streamProcess.on('close', (code) => {
            console.log(`⚠️  Stream process exited with code ${code}`);
            isStreaming = false;
            
            // Auto-restart always (video will loop via reconnect_at_eof)
            console.log('🔄 Restarting stream in 3 seconds (looping video)...');
            setTimeout(() => startStreaming(), 3000);
        });

        streamProcess.on('error', (error) => {
            console.error('❌ Stream process error:', error.message);
            isStreaming = false;
            lastError = error.message;
        });

        console.log('✅ Direct streaming started successfully!');
        return { success: true, message: 'Direct streaming started' };

    } catch (error) {
        console.error('❌ Failed to start streaming:', error.message);
        lastError = error.message;
        return { success: false, error: error.message };
    }
}

// Stop streaming
async function stopStreaming() {
    if (!isStreaming || !streamProcess) {
        console.log('⚠️  Not currently streaming');
        return { success: true, message: 'Not streaming' };
    }

    console.log('⏹️  Stopping stream...');
    streamProcess.kill('SIGTERM');
    isStreaming = false;
    startTime = null;
    console.log('✅ Stream stopped');
    
    return { success: true, message: 'Stream stopped' };
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
    
    res.json({
        status: isStreaming ? 'streaming' : 'stopped',
        uptime: uptime,
        lastError: lastError,
        timestamp: new Date().toISOString(),
        mode: 'direct_stream_efficiency'
    });
});

app.get('/stats', (req, res) => {
    const uptime = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    
    res.json({
        streaming: isStreaming,
        uptime: uptime,
        lastError: lastError,
        architecture: 'Direct Stream (No HLS)',
        efficiency_mode: true
    });
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
    console.log('🔄 Restarting stream...');
    await stopStreaming();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    const result = await startStreaming();
    res.json(result);
});

app.get('/', (req, res) => {
    res.json({
        service: 'Ultra-Simple RTMP Streaming Service',
        version: '3.0.0',
        architecture: 'Direct Stream (No HLS)',
        mode: 'Maximum Efficiency',
        status: isStreaming ? 'streaming' : 'stopped',
        features: [
            'Direct Dropbox to RTMP streaming',
            'No intermediate HLS segmentation',
            'Ultra-low quality for maximum efficiency',
            'Auto-restart on failures',
            'Minimal resource usage'
        ],
        endpoints: {
            health: '/health - Stream status and uptime',
            stats: '/stats - Simple streaming statistics', 
            start: '/start (POST) - Start direct streaming',
            stop: '/stop (POST) - Stop streaming',
            restart: '/restart (POST) - Restart streaming'
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
    console.log('🚀 Ultra-Simple RTMP Streaming Service v3.0 running on port', PORT);
    console.log('🎯 MAXIMUM EFFICIENCY MODE - Direct streaming, no HLS complexity');
    console.log('🌐 Server binding to 0.0.0.0:' + PORT);
    
    console.log('Environment check:');
    console.log(`- RTMP_URL: ${process.env.RTMP_URL ? '✅ Set' : '❌ Missing'}`);
    console.log(`- STREAM_KEY: ${process.env.STREAM_KEY ? '✅ Set' : '❌ Missing'}`);
    console.log(`- VIDEO_URL: ${process.env.VIDEO_URL ? '✅ Set' : '❌ Missing'}`);
    console.log(`- CONTROL_KEY: ${process.env.CONTROL_KEY ? '✅ Set' : '❌ Missing'}`);
    console.log('- ARCHITECTURE: Direct stream (no HLS, no segmentation)');
    console.log('- QUALITY: Ultra-low for maximum efficiency');
    console.log('- RESOLUTION: 160x120 @ 3fps (keyframes every 2s)');
    console.log('- AUDIO: 24k mono');
    console.log('- BITRATE: 80k video + 24k audio = 104k total');

    // Auto-start streaming if environment variables are available
    if (process.env.RTMP_URL && process.env.STREAM_KEY && process.env.VIDEO_URL) {
        console.log('Auto-starting direct streaming in 3 seconds...');
        setTimeout(async () => {
            await startStreaming();
        }, 3000);
    }
});