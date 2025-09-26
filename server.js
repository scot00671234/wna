const express = require('express');
const { spawn } = require('child_process');

const app = express();
// Force port 5000 in production to prevent VPS port mismatches
const PORT = (process.env.NODE_ENV === 'production') ? 5000 : (process.env.PORT || 5000);

let streamProcess = null;
let streamStatus = 'stopped';
let lastError = null;
let startTime = null;
let lastStderr = ''; // Track stderr output for EOF detection
let lastEOFRestart = 0; // Track EOF restarts for rate limiting
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

// Start streaming with robust settings and fallback configurations
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
    console.log('RTMP URL:', rtmpUrl + '/[STREAM_KEY_HIDDEN]');  // Hide stream key for security
    console.log('Video Source:', videoUrl);
    
    // Reset stderr tracking for clean EOF detection
    lastStderr = '';
    
    // Primary configuration - VPS-compatible FFmpeg configuration (no stream_loop for HTTP sources)
    let ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'info',            // More verbose logging for debugging
        '-re',                          // Read at native framerate
        '-reconnect', '1',              // Enable reconnection
        '-reconnect_streamed', '1',     // Reconnect streamed content
        '-reconnect_delay_max', '15',   // Max 15s reconnect delay
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
        '-rw_timeout', '30000000',      // 30 second I/O timeout (more compatible)
        fullRtmpUrl
    ];
    
    // If this is a restart attempt > 5, use simpler fallback configuration
    if (restartAttempts > 5) {
        console.log('🔄 Using simplified fallback FFmpeg configuration for better compatibility...');
        // Minimal configuration for maximum compatibility - no stream_loop for HTTP sources
        ffmpegArgs = [
            '-hide_banner',
            '-loglevel', 'info',
            '-re',
            '-i', videoUrl,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',     // Even faster preset
            '-c:a', 'aac',
            '-b:a', '96k',              // Lower bitrate
            '-maxrate', '1.5M',         // Lower max rate
            '-bufsize', '3M',           // Smaller buffer
            '-f', 'flv',
            fullRtmpUrl
        ];
    }

    // Log FFmpeg command with masked RTMP URL for security
    const maskedArgs = [...ffmpegArgs];
    const rtmpIndex = maskedArgs.indexOf(fullRtmpUrl);
    if (rtmpIndex !== -1) {
        maskedArgs[rtmpIndex] = rtmpUrl + '/[STREAM_KEY_HIDDEN]';
    }
    console.log('FFmpeg command:', 'ffmpeg', maskedArgs.join(' '));
    
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
        lastStderr += output; // Accumulate stderr for EOF detection
        
        // Keep only last 1000 characters to prevent memory issues
        if (lastStderr.length > 1000) {
            lastStderr = lastStderr.slice(-1000);
        }
        
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
        
        // Helper function to detect if exit was due to actual EOF (not generic errors)
        const isEOF = (code, stderr) => {
            if (code === 0) return true; // Clean exit is typically EOF
            if (code === 1) {
                // Only treat specific EOF indicators as EOF, not generic connection errors
                return stderr.includes('End of file') || 
                       stderr.includes('Immediate exit requested') ||
                       stderr.includes('Server returned 416') ||
                       stderr.includes('HTTP/1.1 416'); // HTTP range requests end
            }
            return false;
        };
        
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
            
            // Check if this is an actual EOF or a persistent error
            if (isEOF(code, lastStderr)) {
                // Rate limit EOF restarts to prevent hammering on very short files
                const now = Date.now();
                const minDelay = (now - lastEOFRestart < 10000) ? 3000 : 1000; // 3s if recent EOF, 1s otherwise
                lastEOFRestart = now;
                
                console.log(`📺 HTTP stream ended (EOF) - restart in ${minDelay/1000}s for continuous loop`);
                setTimeout(() => {
                    lastStderr = ''; // Reset stderr tracking
                    startStream();
                }, minDelay);
            } else {
                console.log(`💥 Connection lost. Will restart in ${Math.round(nextDelay/1000)} seconds...`);
                scheduleRestart();
            }
        } else {
            // Clean exit (code 0) - EOF for HTTP streams, restart with rate limiting
            streamStatus = 'error';
            lastError = 'HTTP stream ended (EOF) - continuous loop restart';
            
            const now = Date.now();
            const minDelay = (now - lastEOFRestart < 10000) ? 3000 : 1000; // 3s if recent EOF, 1s otherwise
            lastEOFRestart = now;
            
            console.log(`📺 HTTP stream ended (EOF) - restart in ${minDelay/1000}s for continuous loop`);
            setTimeout(() => {
                lastStderr = ''; // Reset stderr tracking
                startStream();
            }, minDelay);
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

app.post('/start', requireAuth, (req, res) => {
    restartAttempts = 0;
    startStream();
    res.json({ message: 'Stream start requested', status: streamStatus });
});

app.post('/stop', requireAuth, (req, res) => {
    stopStream();
    res.json({ message: 'Stream stopped', status: streamStatus });
});

app.post('/restart', requireAuth, (req, res) => {
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
    console.log(`📡 Server binding to 0.0.0.0:${PORT} for external access`);
    console.log('Environment check:');
    console.log(`- PORT: ${PORT} (${process.env.PORT ? 'from env' : 'default'})`);
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