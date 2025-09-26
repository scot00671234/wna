const express = require('express');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 5000;

let streamProcess = null;
let streamStatus = 'stopped';
let lastError = null;
let startTime = null;
let restartAttempts = 0;
const maxRestartAttempts = 15;
let restartDelay = 5000; // Start with 5 second delay
const maxRestartDelay = 60000; // Max 60 second delay
let intentionalStop = false; // Track if stop was requested

// Middleware
app.use(express.json());

// Progressive backoff restart logic
function scheduleRestart() {
    if (restartAttempts >= maxRestartAttempts) {
        console.log(`Maximum restart attempts (${maxRestartAttempts}) reached. Stopping.`);
        streamStatus = 'failed';
        return;
    }
    
    restartAttempts++;
    // Progressive backoff: increase delay with each attempt
    const currentDelay = Math.min(restartDelay * Math.pow(1.5, restartAttempts - 1), maxRestartDelay);
    console.log(`Scheduling restart attempt ${restartAttempts}/${maxRestartAttempts} in ${Math.round(currentDelay/1000)} seconds`);
    
    setTimeout(() => {
        console.log(`Restart attempt ${restartAttempts}: Starting stream...`);
        startStream();
    }, currentDelay);
}

// Convert Dropbox share URL to direct download URL
function convertDropboxUrl(shareUrl) {
    if (shareUrl.includes('/scl/fi/')) {
        return shareUrl.replace('?dl=0', '?dl=1').replace('&dl=0', '&dl=1');
    }
    return shareUrl.replace('?dl=0', '?dl=1');
}

// Start streaming with robust settings
function startStream() {
    if (streamProcess) {
        console.log('Stream already running');
        return;
    }

    const rtmpUrl = process.env.RTMP_URL;
    const streamKey = process.env.STREAM_KEY;
    const rawVideoUrl = process.env.VIDEO_URL;
    
    if (!rtmpUrl || !streamKey || !rawVideoUrl) {
        const error = 'Missing required environment variables: RTMP_URL, STREAM_KEY, or VIDEO_URL';
        console.error(error);
        lastError = error;
        streamStatus = 'error';
        return;
    }
    
    const videoUrl = convertDropboxUrl(rawVideoUrl);
    const fullRtmpUrl = `${rtmpUrl}/${streamKey}`;
    
    console.log('Starting stream...');
    console.log('RTMP URL:', fullRtmpUrl);
    console.log('Video Source:', videoUrl);
    
    // Production-grade FFmpeg configuration for VPS stability
    const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'info',            // More verbose logging for debugging
        '-re',                          // Read at native framerate
        '-stream_loop', '-1',           // Loop forever
        '-reconnect', '1',              // Enable reconnection
        '-reconnect_streamed', '1',     // Reconnect streamed content
        '-reconnect_delay_max', '15',   // Max 15s reconnect delay
        '-reconnect_on_network_error', '1', // Reconnect on network issues
        '-reconnect_on_http_error', '1', // Reconnect on HTTP errors
        '-i', videoUrl,                 // Input video
        '-c:v', 'libx264',              // Explicit video codec
        '-preset', 'veryfast',          // Fast encoding for real-time
        '-c:a', 'aac',                  // Explicit audio codec
        '-b:a', '128k',                 // Audio bitrate
        '-maxrate', '2M',               // Max video bitrate
        '-bufsize', '4M',               // Buffer size
        '-g', '60',                     // GOP size (keyframe interval)
        '-f', 'flv',                    // FLV output for RTMP
        '-flvflags', 'no_duration_filesize',
        '-rtmp_conn_timeout', '10000000', // 10 second RTMP connection timeout
        '-timeout', '30000000',         // 30 second network timeout
        fullRtmpUrl
    ];

    console.log('FFmpeg command:', 'ffmpeg', ffmpegArgs.join(' '));
    
    streamProcess = spawn('ffmpeg', ffmpegArgs);
    startTime = new Date();
    streamStatus = 'starting';
    lastError = null;

    let isConnected = false;

    streamProcess.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    streamProcess.stderr.on('data', (data) => {
        const output = data.toString();
        
        // Enhanced logging with error code detection
        if (output.includes('error') || output.includes('failed') || output.includes('Error') || output.includes('time=')) {
            console.log(`stderr: ${output.trim()}`);
            
            // Specific error detection for better diagnostics
            if (output.includes('Connection refused') || output.includes('Network is unreachable')) {
                console.log('🚨 NETWORK CONNECTIVITY ISSUE DETECTED');
            } else if (output.includes('Invalid argument') || output.includes('Option') || output.includes('does not exist')) {
                console.log('🚨 FFMPEG CONFIGURATION ISSUE DETECTED');
            } else if (output.includes('RTMP') && output.includes('error')) {
                console.log('🚨 RTMP PROTOCOL ISSUE DETECTED');
            }
        }
        
        // Check for successful connection with better detection
        if ((output.includes('Stream mapping:') || output.includes('fps=') || output.includes('frame=')) && !isConnected) {
            isConnected = true;
            streamStatus = 'streaming';
            console.log('🔴 STREAM CONNECTED - Broadcasting live');
            console.log(`📊 Current restart attempts: ${restartAttempts}`);
            
            // Reset restart attempts after successful connection
            setTimeout(() => {
                if (streamStatus === 'streaming') {
                    console.log('✅ Stream stable - resetting restart counter');
                    restartAttempts = 0;
                    restartDelay = 5000; // Reset to initial delay
                }
            }, 45000); // Wait 45 seconds before resetting
        }
    });

    streamProcess.on('close', (code) => {
        console.log(`🔄 FFmpeg process exited with code ${code}`);
        
        // Enhanced error code diagnostics
        if (code === 234) {
            console.log('🚨 Exit code 234: Configuration or hardware acceleration issue');
            console.log('💡 Suggestion: Check codec compatibility and disable hardware acceleration');
        } else if (code === 1) {
            console.log('🚨 Exit code 1: General error (network, file access, or codec issue)');
        } else if (code > 0) {
            console.log(`🚨 Exit code ${code}: FFmpeg error occurred`);
        }
        
        streamProcess = null;
        isConnected = false;
        
        if (intentionalStop) {
            // This was an intentional stop - don't restart
            streamStatus = 'stopped';
            restartAttempts = 0;
            restartDelay = 5000; // Reset delay
            intentionalStop = false;
            console.log('✅ Stream stopped intentionally');
        } else if (code !== 0) {
            // This was an unexpected failure - restart
            streamStatus = 'error';
            lastError = `Stream failed with exit code ${code} (attempt ${restartAttempts + 1}/${maxRestartAttempts})`;
            const nextDelay = Math.min(restartDelay * Math.pow(1.5, restartAttempts), maxRestartDelay);
            console.log(`💥 Connection lost. Will restart in ${Math.round(nextDelay/1000)} seconds...`);
            scheduleRestart();
        } else {
            // Clean exit but not intentional - still restart for 24/7 operation
            streamStatus = 'error';
            lastError = 'Stream ended unexpectedly (clean exit but not requested)';
            console.log('⚠️ Stream ended unexpectedly. Restarting...');
            scheduleRestart();
        }
    });

    streamProcess.on('error', (error) => {
        console.error('FFmpeg process error:', error.message);
        streamStatus = 'error';
        lastError = error.message;
        streamProcess = null;
        scheduleRestart();
    });
}

// Stop streaming
function stopStream() {
    if (streamProcess) {
        console.log('Stopping stream...');
        intentionalStop = true; // Mark this as intentional
        streamProcess.kill('SIGTERM');
        // Don't set streamProcess = null here, let the close handler do it
        restartAttempts = 0;
    } else {
        streamStatus = 'stopped';
        startTime = null;
    }
}

// API Endpoints
app.get('/health', (req, res) => {
    const uptime = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    
    res.json({
        status: streamStatus,
        uptime: uptime,
        restartAttempts: restartAttempts,
        maxRestartAttempts: maxRestartAttempts,
        lastError: lastError,
        timestamp: new Date().toISOString(),
        pid: streamProcess ? streamProcess.pid : null
    });
});

app.post('/start', (req, res) => {
    restartAttempts = 0;
    startStream();
    res.json({ message: 'Stream start requested', status: streamStatus });
});

app.post('/stop', (req, res) => {
    stopStream();
    res.json({ message: 'Stream stopped', status: streamStatus });
});

app.post('/restart', (req, res) => {
    stopStream();
    setTimeout(() => startStream(), 2000);
    res.json({ message: 'Stream restart requested', status: streamStatus });
});

app.get('/', (req, res) => {
    res.json({
        service: 'RTMP Streaming Service',
        status: streamStatus,
        restartAttempts: restartAttempts,
        endpoints: {
            health: '/health',
            start: '/start (POST)',
            stop: '/stop (POST)',
            restart: '/restart (POST)'
        }
    });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down...');
    stopStream();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down...');
    stopStream();
    process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 RTMP Streaming Service running on port ${PORT}`);
    console.log('Environment check:');
    console.log(`- RTMP_URL: ${process.env.RTMP_URL ? '✅ Set' : '❌ Missing'}`);
    console.log(`- STREAM_KEY: ${process.env.STREAM_KEY ? '✅ Set' : '❌ Missing'}`);
    console.log(`- VIDEO_URL: ${process.env.VIDEO_URL ? '✅ Set' : '❌ Missing'}`);
    
    // Auto-start streaming after 3 seconds
    console.log('Auto-starting stream in 3 seconds...');
    setTimeout(() => {
        console.log('Initializing stream...');
        startStream();
    }, 3000);
});