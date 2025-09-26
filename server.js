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
let currentPosition = 0; // Current position in video (seconds)
let lastStablePosition = 0; // Last known stable position for resume
let totalStreamTime = 0; // Total accumulated stream time
let sessionStartPosition = 0; // Position where current session started

// Middleware
app.use(express.json());

// Parse FFmpeg output to extract current position
function parsePosition(output) {
    // Look for time=00:00:05.80 format in FFmpeg output
    const timeMatch = output.match(/time=([0-9]{2}):([0-9]{2}):([0-9]{2})\\.([0-9]{2})/);
    if (timeMatch) {
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const seconds = parseInt(timeMatch[3]);
        const centiseconds = parseInt(timeMatch[4]);
        return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
    }
    return null;
}

// Update current position and save stable checkpoints
function updatePosition(newPosition) {
    if (newPosition && newPosition >= 0) {
        // Calculate actual position in the video (session start + current offset)
        const actualPosition = sessionStartPosition + newPosition;
        currentPosition = actualPosition;
        
        // Save as stable position every 3 seconds of progress
        if (currentPosition - lastStablePosition >= 3) {
            lastStablePosition = currentPosition;
            totalStreamTime = currentPosition;
            console.log(`✓ Position checkpoint: ${Math.floor(lastStablePosition)}s (total: ${formatTime(lastStablePosition)})`);
        }
    }
}

// Format seconds to HH:MM:SS format for FFmpeg
function formatTimeForFFmpeg(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Format seconds to human readable time
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Determine if stream should restart based on error code
function shouldRestartStream(exitCode) {
    // Don't restart if we've exceeded max attempts
    if (restartAttempts >= maxRestartAttempts) {
        console.log(`Maximum restart attempts (${maxRestartAttempts}) reached`);
        return false;
    }
    
    // Log the exit code for monitoring
    console.log(`FFmpeg exit code: ${exitCode} - determining restart action`);
    
    // All exit codes should restart for maximum resilience
    console.log(`Exit code ${exitCode} is retryable, will resume from position ${Math.floor(lastStablePosition)}s`);
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
    console.log(`Will resume from position: ${formatTime(lastStablePosition)}`);
    
    setTimeout(() => {
        console.log(`Restart attempt ${restartAttempts}: Resuming stream from ${formatTime(lastStablePosition)}...`);
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

// Start FFmpeg streaming process with position resume capability
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
    
    // Calculate resume position - use last stable position for restarts
    const resumePosition = restartAttempts > 0 ? lastStablePosition : 0;
    sessionStartPosition = resumePosition;
    
    console.log('Starting stream...');
    console.log('RTMP URL:', fullRtmpUrl);
    console.log('Video Source:', videoUrl);
    if (resumePosition > 0) {
        console.log(`⏯️  Resuming from position: ${formatTime(resumePosition)}`);
    } else {
        console.log('🎬 Starting from beginning');
    }
    
    // Build FFmpeg arguments with position resume
    const ffmpegArgs = [
        '-hide_banner', // Reduce log verbosity
        '-loglevel', 'info', // Set appropriate log level
    ];
    
    // Add seek position if resuming
    if (resumePosition > 0) {
        ffmpegArgs.push('-ss', formatTimeForFFmpeg(resumePosition));
    }
    
    // Add input and streaming arguments
    ffmpegArgs.push(
        '-re', // Read input at native frame rate
        '-stream_loop', '-1', // Loop the input indefinitely
        '-timeout', '30000000', // 30 second timeout for network operations
        '-reconnect', '1', // Enable reconnection
        '-reconnect_streamed', '1', // Reconnect for streamed content
        '-reconnect_delay_max', '5', // Max reconnect delay in seconds
        '-reconnect_at_eof', '1', // Reconnect at end of file
        '-i', videoUrl, // Input video URL
        '-c', 'copy', // Copy streams without re-encoding
        '-f', 'flv', // Output format for RTMP
        '-flvflags', 'no_duration_filesize+no_metadata',
        '-avoid_negative_ts', 'make_zero', // Handle timestamp issues
        '-fflags', '+genpts+flush_packets', // Generate PTS and flush packets
        '-rtmp_live', 'live', // RTMP live streaming mode
        '-rtmp_buffer', '1000', // RTMP buffer size  
        '-rtmp_flush_interval', '10', // Flush every 10 packets
        fullRtmpUrl
    );

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
        
        // Parse position from output and update tracking
        const position = parsePosition(output);
        if (position !== null) {
            updatePosition(position);
        }
        
        // Check if stream is successfully connected and stable
        if (output.includes('Stream mapping:') || output.includes('fps=')) {
            if (streamStatus === 'starting') {
                streamStatus = 'streaming';
                console.log(`🔴 Stream active, broadcasting from position ${formatTime(sessionStartPosition)}`);
                
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
        console.log(`Last position: ${formatTime(currentPosition)} | Stable checkpoint: ${formatTime(lastStablePosition)}`);
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

// Reset position tracking (for testing or manual resets)
function resetPosition() {
    currentPosition = 0;
    lastStablePosition = 0;
    totalStreamTime = 0;
    sessionStartPosition = 0;
    console.log('Position tracking reset to beginning');
}

// Health check endpoint with position info
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
        maxRestartAttempts: maxRestartAttempts,
        currentPosition: Math.floor(currentPosition),
        currentPositionFormatted: formatTime(currentPosition),
        lastStablePosition: Math.floor(lastStablePosition),
        lastStablePositionFormatted: formatTime(lastStablePosition),
        totalStreamTime: Math.floor(totalStreamTime),
        totalStreamTimeFormatted: formatTime(totalStreamTime)
    });
});

// Stream control endpoints
app.post('/start', (req, res) => {
    // Reset restart attempts when manually starting
    restartAttempts = 0;
    startStream();
    res.json({ 
        message: 'Stream start requested', 
        status: streamStatus,
        resumePosition: formatTime(lastStablePosition)
    });
});

app.post('/stop', (req, res) => {
    stopStream();
    res.json({ message: 'Stream stopped', status: streamStatus });
});

app.post('/restart', (req, res) => {
    stopStream();
    setTimeout(() => startStream(), 1000);
    res.json({ 
        message: 'Stream restart requested', 
        status: streamStatus,
        resumePosition: formatTime(lastStablePosition)
    });
});

// Reset position endpoint for testing
app.post('/reset-position', (req, res) => {
    resetPosition();
    res.json({ 
        message: 'Position reset to beginning',
        currentPosition: formatTime(currentPosition)
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        service: 'RTMP Streaming Service',
        status: streamStatus,
        restartAttempts: restartAttempts,
        currentPosition: formatTime(currentPosition),
        lastStablePosition: formatTime(lastStablePosition),
        endpoints: {
            health: '/health',
            start: '/start (POST)',
            stop: '/stop (POST)',
            restart: '/restart (POST)',
            resetPosition: '/reset-position (POST)'
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
    setTimeout(() => startStream(), 5000);
});