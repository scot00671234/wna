const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
// Using built-in HTTP instead of node-fetch to avoid ESM issues

class StreamFetcher {
    constructor(videoUrl, cacheDir, options = {}) {
        this.videoUrl = videoUrl;
        this.cacheDir = cacheDir;
        this.segmentDuration = options.segmentDuration || 1; // 1 second segments for lower latency
        this.lookaheadSeconds = options.lookaheadSeconds || 30; // 30 seconds ahead (reduced for efficiency)
        this.maxCacheSize = options.maxCacheSize || 150; // 150 seconds total cache (reduced for RAM usage)
        
        this.currentSegment = 0;
        this.segments = new Map(); // segmentId -> { file, timestamp, duration, ready }
        this.prefetchQueue = [];
        this.isRunning = false;
        this.lastError = null;
        this.fileWatcher = null; // For filesystem monitoring
        
        this.checkpointFile = path.join(cacheDir, 'checkpoint.json');
    }

    async initialize() {
        try {
            // Create cache directory
            await fs.mkdir(this.cacheDir, { recursive: true });
            
            // Load checkpoint if exists
            await this.loadCheckpoint();
            
            console.log('🚀 Stream Fetcher initialized');
            console.log(`📁 Cache directory: ${this.cacheDir}`);
            console.log(`🎯 Starting from segment: ${this.currentSegment}`);
            
            return true;
        } catch (error) {
            console.error('❌ Fetcher initialization failed:', error.message);
            this.lastError = error.message;
            return false;
        }
    }

    async loadCheckpoint() {
        try {
            const data = await fs.readFile(this.checkpointFile, 'utf8');
            const checkpoint = JSON.parse(data);
            this.currentSegment = checkpoint.currentSegment || 0;
            
            // Verify cached segments still exist
            for (const [segId, segData] of Object.entries(checkpoint.segments || {})) {
                const segmentFile = path.join(this.cacheDir, `segment_${segId}.ts`);
                try {
                    await fs.access(segmentFile);
                    this.segments.set(parseInt(segId), { ...segData, file: segmentFile });
                } catch {
                    // Segment file doesn't exist anymore
                    console.log(`🗑️  Removing stale segment ${segId} from cache`);
                }
            }
            
            console.log(`📋 Checkpoint loaded: segment ${this.currentSegment}, ${this.segments.size} cached segments`);
        } catch (error) {
            // No checkpoint or invalid, start fresh
            console.log('📋 No checkpoint found, starting fresh');
        }
    }

    async saveCheckpoint() {
        try {
            const checkpoint = {
                currentSegment: this.currentSegment,
                timestamp: new Date().toISOString(),
                segments: {}
            };
            
            // Save segment metadata
            for (const [segId, segData] of this.segments.entries()) {
                checkpoint.segments[segId] = {
                    timestamp: segData.timestamp,
                    duration: segData.duration,
                    ready: segData.ready
                };
            }
            
            await fs.writeFile(this.checkpointFile, JSON.stringify(checkpoint, null, 2));
        } catch (error) {
            console.error('⚠️  Failed to save checkpoint:', error.message);
        }
    }

    async start() {
        if (this.isRunning) {
            console.log('⚠️  Fetcher already running');
            return;
        }
        
        this.isRunning = true;
        console.log('🎬 Starting stream fetcher...');
        
        // Start prefetch loop
        this.prefetchLoop();
        
        // Start segment generation
        await this.generateSegments();
    }

    async stop() {
        this.isRunning = false;
        
        // Clean up file watcher
        if (this.fileWatcher) {
            clearInterval(this.fileWatcher);
            this.fileWatcher = null;
        }
        
        await this.saveCheckpoint();
        console.log('⏹️  Stream fetcher stopped');
    }

    async generateSegments() {
        console.log('🎞️  Starting segment generation...');
        
        // Generate initial segments
        const segmentsToGenerate = Math.ceil(this.maxCacheSize / this.segmentDuration);
        
        // Fixed HLS-based pipeline for true continuity (no -re for faster prefetch)
        const hlsPlaylist = path.join(this.cacheDir, 'stream.m3u8');
        // Hardware acceleration detection
        const hwAccelArgs = process.env.FFMPEG_HWACCEL ? ['-hwaccel', process.env.FFMPEG_HWACCEL] : [];
        
        const ffmpegArgs = [
            '-hide_banner',
            '-loglevel', 'info',
            ...hwAccelArgs,
            '-reconnect', '1',
            '-reconnect_streamed', '1', 
            '-reconnect_delay_max', '30',
            '-i', this.videoUrl,
            // Optimized for audiobooks - lower CPU usage, better efficiency
            '-c:v', 'libx264',
            '-preset', 'superfast', // Faster than ultrafast but better quality
            '-tune', 'stillimage', // Optimized for static/minimal video content
            '-crf', '28', // Higher CRF for audiobooks (less important video quality)
            '-maxrate', '500k', // Lower bitrate for audiobooks
            '-bufsize', '1000k',
            '-c:a', 'aac',
            '-b:a', '64k', // Lower audio bitrate sufficient for speech
            '-ar', '22050', // Lower sample rate for speech
            '-g', `${this.segmentDuration * 10}`, // GOP size optimized for 1s segments
            '-force_key_frames', `expr:gte(t,n_forced*${this.segmentDuration})`,
            '-f', 'hls',
            '-hls_time', this.segmentDuration.toString(),
            '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments',
            '-hls_list_size', Math.ceil(this.maxCacheSize / this.segmentDuration),
            '-hls_segment_type', 'mpegts',
            '-hls_segment_filename', path.join(this.cacheDir, 'segment_%d.ts'),
            hlsPlaylist
        ];

        console.log(`🔧 FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);
        
        const segmentProcess = spawn('ffmpeg', ffmpegArgs);
        
        let hasStarted = false;
        let lastOutput = '';
        
        segmentProcess.stderr.on('data', (data) => {
            const output = data.toString();
            lastOutput = output;
            
            // Smart logging: Show segment creation and errors, filter out fps spam
            if (output.includes('Opening') || output.includes('segment_') || 
                output.includes('error') || output.includes('failed') || output.includes('warning') ||
                (output.includes('fps=') && !hasStarted)) {
                console.log(`📹 FFmpeg: ${output.trim()}`);
            }
            
            // Multiple ways to detect segment creation
            if (output.includes('Opening') && output.includes('segment_')) {
                const match = output.match(/segment_(\d+)\.ts/);
                if (match) {
                    const segmentId = parseInt(match[1]);
                    this.registerSegment(segmentId);
                }
            }
            
            // Alternative detection for segment writing
            if (output.includes('segment_') && output.includes('.ts')) {
                const match = output.match(/segment_(\d+)\.ts/);
                if (match) {
                    const segmentId = parseInt(match[1]);
                    setTimeout(() => this.registerSegment(segmentId), 100); // Small delay to ensure file is written
                }
            }
            
            // Detect if stream is being processed
            if (output.includes('fps=') || output.includes('time=')) {
                hasStarted = true;
            }
            
            // Error detection
            if (output.includes('Connection refused') || 
                output.includes('No such file') || 
                output.includes('Invalid data') ||
                output.includes('Protocol not found')) {
                console.error(`❌ FFmpeg error: ${output.trim()}`);
                this.lastError = output.trim();
            }
        });

        segmentProcess.on('close', (code) => {
            console.log(`⚠️  Segment generation exited with code ${code}`);
            console.log(`📝 Last FFmpeg output: ${lastOutput.trim()}`);
            
            if (this.isRunning) {
                const delay = hasStarted ? 2000 : 5000; // Longer delay if never started
                console.log(`🔄 Restarting segment generation in ${delay/1000}s...`);
                setTimeout(() => this.generateSegments(), delay);
            }
        });

        segmentProcess.on('error', (error) => {
            console.error('❌ Segment generation spawn error:', error.message);
            this.lastError = error.message;
        });
        
        // Skip filesystem monitoring - FFmpeg output is sufficient
        // this.startFileSystemMonitoring();
    }

    startFileSystemMonitoring() {
        // DISABLED: Filesystem monitoring removed for performance optimization
        // FFmpeg output parsing is sufficient for segment detection
        // This eliminates duplicate segment registration and reduces I/O overhead
        console.log('📈 Filesystem monitoring disabled for optimized performance');
        return;
    }

    async registerSegment(segmentId) {
        const segmentFile = path.join(this.cacheDir, `segment_${segmentId}.ts`);
        
        try {
            const stats = await fs.stat(segmentFile);
            this.segments.set(segmentId, {
                file: segmentFile,
                timestamp: new Date(),
                duration: this.segmentDuration,
                ready: true
            });
            
            // Reduce logging frequency - only log every 100th segment
            if (segmentId % 100 === 0) {
                console.log(`✅ Segment ${segmentId} ready (${(stats.size / 1024).toFixed(1)}KB)`);
            }
            
            // Clean up old segments
            await this.cleanupOldSegments();
            
            // Save checkpoint less frequently to reduce I/O
            if (segmentId % 100 === 0) {
                await this.saveCheckpoint();
            }
            
        } catch (error) {
            console.error(`❌ Failed to register segment ${segmentId}:`, error.message);
        }
    }

    async cleanupOldSegments() {
        // Let HLS muxer handle segment cleanup automatically via delete_segments
        // Only clean up our metadata tracking, not the physical files
        const maxSegments = Math.ceil(this.maxCacheSize / this.segmentDuration);
        const sortedSegments = Array.from(this.segments.keys()).sort((a, b) => a - b);
        
        if (sortedSegments.length > maxSegments) {
            const toRemove = sortedSegments.slice(0, sortedSegments.length - maxSegments);
            
            for (const segmentId of toRemove) {
                // Only remove from tracking, let ffmpeg handle file deletion
                this.segments.delete(segmentId);
                console.log(`📋 Removed segment ${segmentId} from tracking (file handled by HLS muxer)`);
            }
        }
    }

    async prefetchLoop() {
        while (this.isRunning) {
            try {
                const currentTime = Date.now();
                const neededSegments = Math.ceil(this.lookaheadSeconds / this.segmentDuration);
                
                // Check if we have enough segments ahead
                const availableAhead = Array.from(this.segments.keys())
                    .filter(id => id >= this.currentSegment)
                    .length;
                
                if (availableAhead < neededSegments) {
                    console.log(`🔄 Need ${neededSegments - availableAhead} more segments for lookahead`);
                }
                
                await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
                
            } catch (error) {
                console.error('⚠️  Prefetch loop error:', error.message);
            }
        }
    }

    getSegment(segmentId) {
        return this.segments.get(segmentId);
    }

    getCurrentSegment() {
        return this.currentSegment;
    }

    advanceSegment() {
        this.currentSegment++;
        return this.currentSegment;
    }

    getAvailableSegments() {
        return Array.from(this.segments.keys()).sort((a, b) => a - b);
    }

    getStats() {
        const availableSegments = this.getAvailableSegments();
        const lastSegment = availableSegments[availableSegments.length - 1] || 0;
        const lookaheadSegments = availableSegments.filter(id => id >= this.currentSegment).length;
        
        return {
            isRunning: this.isRunning,
            currentSegment: this.currentSegment,
            totalSegments: availableSegments.length,
            lastSegment: lastSegment,
            lookaheadSegments: lookaheadSegments,
            lookaheadSeconds: lookaheadSegments * this.segmentDuration,
            cacheSize: this.segments.size,
            lastError: this.lastError
        };
    }
}

module.exports = StreamFetcher;