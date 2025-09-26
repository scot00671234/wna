const express = require('express');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

let streamProcess = null;
let streamStatus = 'stopped';
let lastError = null;
let startTime = null;
let restartAttempts = 0;
let maxRestartAttempts = 10;
let baseRestartDelay = 5000; // 5 seconds
let maxRestartDelay = 300000; // 5 minutes

// Middleware
app.use(express.json());

// Determine if stream should restart based on error code
function shouldRestartStream(exitCode) {
    // Don't restart if we've exceeded max attempts
    if (restartAttempts >= maxRestartAttempts) {
        console.log(`Maximum restart attempts (${maxRestartAttempts}) reached`);
        return false;
    }
    
    // Log the exit code for monitoring
    console.log(`FFmpeg exit code: ${exitCode} - determining restart action`);
    
    // Most exit codes should trigger restart, especially network-related ones
    // Only a very small set of codes indicate truly fatal configuration errors
    const fatalCodes = []; // Start with no fatal codes - let everything restart
    
    if (fatalCodes.includes(exitCode)) {
        console.log(`Fatal error code ${exitCode}, not restarting`);
        return false;
    }
    
    // All exit codes (including 1, 152, etc.) should restart for network resilience
    console.log(`Exit code ${exitCode} is retryable, scheduling restart`);
    return true;
}

// Schedule restart with exponential backoff
function scheduleRestart() {
    restartAttempts++;
    
    // Calculate delay with exponential backoff
    const delay = Math.min(
        baseRestartDelay * Math.pow(2, restartAttempts - 1),
        maxRestartDelay
    );
    
    console.log(`Scheduling restart attempt ${restartAttempts}/${maxRestartAttempts} in ${delay/1000} seconds`);
    
    setTimeout(() => {
        console.log(`Restart attempt ${restartAttempts}: Starting stream...`);
        startStream();
    }, delay);
}

// Reset restart attempts on successful connection
function resetRestartAttempts() {
    if (restartAttempts > 0) {
        console.log(`Stream stable, resetting restart attempts (was ${restartAttempts})`);
        restartAttempts = 0;
    }
}

// Convert Dropbox share URL to direct download URL
function convertDropboxUrl(shareUrl) {
    // For new Dropbox share URLs (scl/fi format), change dl=0 to dl=1
    if (shareUrl.includes('/scl/fi/')) {
        return shareUrl.replace('?dl=0', '?dl=1').replace('&dl=0', '&dl=1');
    }
    // For old format URLs
    return shareUrl.replace('?dl=0', '?dl=1').replace('/s/', '/scl/fi/');
}

// Start FFmpeg streaming process
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
    
    // FFmpeg command to stream video from URL to RTMP with enhanced stability
    const ffmpegArgs = [
        '-re', // Read input at native frame rate
        '-stream_loop', '-1', // Loop the input indefinitely
        '-timeout', '10000000', // 10 second timeout for network operations
        '-reconnect', '1', // Enable reconnection
        '-reconnect_streamed', '1', // Reconnect for streamed content
        '-reconnect_delay_max', '2', // Max reconnect delay in seconds
        '-i', videoUrl, // Input video URL
        '-c', 'copy', // Copy streams without re-encoding
        '-f', 'flv', // Output format for RTMP
        '-flvflags', 'no_duration_filesize',
        '-bufsize', '2000k', // Set buffer size
        '-maxrate', '2000k', // Set max bitrate to prevent spikes
        '-tcp_nodelay', '1', // Reduce latency
        '-rtmp_live', 'live', // RTMP live streaming mode
        fullRtmpUrl
    ];

    streamProcess = spawn('ffmpeg', ffmpegArgs);
    startTime = new Date();
    streamStatus = 'starting';
    lastError = null;

    streamProcess.stdout.on('data', (data) => {
        console.log(`FFmpeg stdout: ${data}`);
    });

    streamProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.log(`FFmpeg stderr: ${output}`);
        
        // Check if stream is successfully connected and stable
        if (output.includes('Stream mapping:') || output.includes('fps=')) {
            if (streamStatus === 'starting') {
                streamStatus = 'streaming';
                // Reset restart attempts after 30 seconds of stable streaming
                setTimeout(() => {
                    if (streamStatus === 'streaming') {
                        resetRestartAttempts();
                    }
                }, 30000);
            }
        }
    });

    streamProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        streamProcess = null;
        
        if (code !== 0) {
            streamStatus = 'error';
            lastError = `FFmpeg exited with code ${code}`;
            
            // Check if we should restart based on error code and attempt count
            if (shouldRestartStream(code)) {
                scheduleRestart();
            } else {
                console.log('Stream stopped due to fatal error or too many restart attempts');
                streamStatus = 'failed';
            }
        } else {
            streamStatus = 'stopped';
            // Reset restart attempts on clean exit
            restartAttempts = 0;
        }
    });

    streamProcess.on('error', (error) => {
        console.error('FFmpeg error:', error);
        streamStatus = 'error';
        lastError = error.message;
        streamProcess = null;
        
        // Schedule restart with exponential backoff
        scheduleRestart();
    });
}

// Stop streaming process
function stopStream() {
    if (streamProcess) {
        streamProcess.kill('SIGTERM');
        streamProcess = null;
        streamStatus = 'stopped';
        startTime = null;
        restartAttempts = 0; // Reset attempts when manually stopped
        console.log('Stream stopped');
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    const uptime = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    
    res.json({
        status: streamStatus,
        uptime: uptime,
        uptimeFormatted: formatUptime(uptime),
        lastError: lastError,
        timestamp: new Date().toISOString(),
        pid: streamProcess ? streamProcess.pid : null,
        restartAttempts: restartAttempts,
        maxRestartAttempts: maxRestartAttempts
    });
});

// Stream control endpoints
app.post('/start', (req, res) => {
    // Reset restart attempts when manually starting
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
    setTimeout(() => startStream(), 1000);
    res.json({ message: 'Stream restart requested', status: streamStatus });
});

// Root endpoint
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

// Format uptime in human readable format
function formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}h ${minutes}m ${secs}s`;
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    stopStream();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    stopStream();
    process.exit(0);
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`RTMP Streaming Service running on port ${PORT}`);
    console.log('Environment check:');
    console.log('- RTMP_URL:', process.env.RTMP_URL ? 'Set' : 'Missing');
    console.log('- STREAM_KEY:', process.env.STREAM_KEY ? 'Set' : 'Missing');
    console.log('- VIDEO_URL:', process.env.VIDEO_URL ? 'Set' : 'Missing');
    
    // Auto-start streaming when server starts
    console.log('Auto-starting stream...');
    setTimeout(() => startStream(), 2000);
});