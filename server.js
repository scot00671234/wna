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
        const rawAudioUrl = process.env.AUDIO_URL;
        
        if (!rtmpUrl || !streamKey || !rawAudioUrl) {
            throw new Error('Missing required environment variables: RTMP_URL, STREAM_KEY, or AUDIO_URL');
        }

        const audioUrl = convertDropboxUrl(rawAudioUrl);
        const coverImagePath = './assets/cover.png';
        const fullRtmpUrl = `${rtmpUrl}/${streamKey}`;

        console.log('🎵 Starting AUDIO streaming with static image (ultra-lightweight)...');
        console.log('🎯 ZERO LAG MODE - MP3 audio + static image for maximum efficiency');
        
        // ULTRA-LIGHTWEIGHT: Static image + MP3 audio streaming
        const ffmpegArgs = [
            '-hide_banner',
            '-loglevel', 'error', // Only show actual errors
            
            // INPUT 1: Static cover image (looped)
            '-loop', '1',
            '-i', coverImagePath,
            
            // INPUT 2: MP3 audio from Dropbox (with seamless looping)
            '-re', // Real-time streaming
            '-stream_loop', '-1', // Infinite loop for seamless playback
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '10',
            '-i', audioUrl,
            
            // VIDEO: Ultra-efficient static image encoding
            '-c:v', 'libx264',
            '-preset', 'ultrafast', // Fastest possible encoding
            '-tune', 'stillimage', // Optimized for static images
            '-crf', '35', // Good quality for static image
            '-maxrate', '50k', // Very low bitrate since image doesn't change
            '-bufsize', '100k',
            '-s', '1280x720', // Better quality since it's just a static image
            '-r', '1', // Ultra low framerate (1 fps) - image doesn't change
            '-pix_fmt', 'yuv420p',
            
            // ZERO-LAG KEYFRAME SETTINGS - Frequent keyframes for instant viewer join
            '-g', '1', // GOP size: keyframe every second for zero lag
            '-keyint_min', '1', // Minimum keyframe interval
            '-sc_threshold', '0', // Disable scene change detection
            
            // AUDIO: High quality since this is the main content
            '-c:a', 'aac',
            '-b:a', '128k', // Good audio quality for audiobook
            '-ar', '44100', // Standard sample rate
            '-ac', '2', // Stereo audio
            
            // Map streams: video from image, audio from MP3
            '-map', '0:v:0', // Video from input 0 (image)
            '-map', '1:a:0', // Audio from input 1 (MP3)
            
            // Ensure continuous streaming (no auto-exit)
            // Removed -shortest to maintain 24/7 continuous streaming
            
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
            
            // Auto-restart always (audio will loop via reconnect_at_eof)
            console.log('🔄 Restarting stream in 3 seconds (looping audio)...');
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
        mode: 'audio_stream_zero_lag'
    });
});

app.get('/stats', (req, res) => {
    const uptime = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    
    res.json({
        streaming: isStreaming,
        uptime: uptime,
        lastError: lastError,
        architecture: 'Static Image + MP3 Audio Stream',
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
        service: 'Ultra-Lightweight Audio Streaming Service',
        version: '4.0.0',
        architecture: 'Static Image + MP3 Audio Stream',
        mode: 'Zero Lag Audio Streaming',
        status: isStreaming ? 'streaming' : 'stopped',
        features: [
            'MP3 audio streaming from Dropbox',
            'Static HD image for visual component',
            'Ultra-lightweight (178k total bitrate)',
            'Zero lag audiobook streaming',
            'Auto-restart and looping',
            'Minimal CPU usage'
        ],
        endpoints: {
            health: '/health - Stream status and uptime',
            stats: '/stats - Simple streaming statistics', 
            start: '/start (POST) - Start audio streaming',
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
    console.log('🚀 Ultra-Lightweight Audio Streaming Service v4.0 running on port', PORT);
    console.log('🎯 ZERO LAG MODE - MP3 audio + static image streaming');
    console.log('🌐 Server binding to 0.0.0.0:' + PORT);
    
    console.log('Environment check:');
    console.log(`- RTMP_URL: ${process.env.RTMP_URL ? '✅ Set' : '❌ Missing'}`);
    console.log(`- STREAM_KEY: ${process.env.STREAM_KEY ? '✅ Set' : '❌ Missing'}`);
    console.log(`- AUDIO_URL: ${process.env.AUDIO_URL ? '✅ Set' : '❌ Missing'}`);
    console.log(`- CONTROL_KEY: ${process.env.CONTROL_KEY ? '✅ Set' : '❌ Missing'}`);
    console.log('- ARCHITECTURE: Static image + MP3 audio streaming');
    console.log('- QUALITY: High quality audio, static HD image');
    console.log('- RESOLUTION: 1280x720 @ 1fps (static image)');
    console.log('- AUDIO: 128k stereo (optimized for audiobook)');
    console.log('- BITRATE: 50k video + 128k audio = 178k total');

    // Auto-start streaming if environment variables are available
    if (process.env.RTMP_URL && process.env.STREAM_KEY && process.env.AUDIO_URL) {
        console.log('Auto-starting audio streaming in 3 seconds...');
        setTimeout(async () => {
            await startStreaming();
        }, 3000);
    }
});