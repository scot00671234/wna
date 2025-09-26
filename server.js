const express = require('express');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

let streamProcess = null;
let streamStatus = 'stopped';
let lastError = null;
let startTime = null;

// Middleware
app.use(express.json());

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
    
    // FFmpeg command to stream video from URL to RTMP
    const ffmpegArgs = [
        '-re', // Read input at native frame rate
        '-stream_loop', '-1', // Loop the input indefinitely
        '-i', videoUrl, // Input video URL
        '-c', 'copy', // Copy streams without re-encoding
        '-f', 'flv', // Output format for RTMP
        '-flvflags', 'no_duration_filesize',
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
        
        // Check if stream is successfully connected
        if (output.includes('Stream mapping:') || output.includes('fps=')) {
            streamStatus = 'streaming';
        }
    });

    streamProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        streamProcess = null;
        
        if (code !== 0) {
            streamStatus = 'error';
            lastError = `FFmpeg exited with code ${code}`;
            
            // Auto-restart after 5 seconds if there was an error
            setTimeout(() => {
                console.log('Attempting to restart stream...');
                startStream();
            }, 5000);
        } else {
            streamStatus = 'stopped';
        }
    });

    streamProcess.on('error', (error) => {
        console.error('FFmpeg error:', error);
        streamStatus = 'error';
        lastError = error.message;
        streamProcess = null;
        
        // Auto-restart after 5 seconds
        setTimeout(() => {
            console.log('Attempting to restart stream after error...');
            startStream();
        }, 5000);
    });
}

// Stop streaming process
function stopStream() {
    if (streamProcess) {
        streamProcess.kill('SIGTERM');
        streamProcess = null;
        streamStatus = 'stopped';
        startTime = null;
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
        pid: streamProcess ? streamProcess.pid : null
    });
});

// Stream control endpoints
app.post('/start', (req, res) => {
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