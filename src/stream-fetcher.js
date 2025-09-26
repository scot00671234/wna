const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
// Using built-in HTTP instead of node-fetch to avoid ESM issues

class StreamFetcher {
    constructor(videoUrl, cacheDir, options = {}) {
        this.videoUrl = videoUrl;
        this.cacheDir = cacheDir;
        this.segmentDuration = options.segmentDuration || 2; // 2 second segments
        this.lookaheadSeconds = options.lookaheadSeconds || 60; // 60 seconds ahead
        this.maxCacheSize = options.maxCacheSize || 300; // 300 seconds total cache
        
        this.currentSegment = 0;
        this.segments = new Map(); // segmentId -> { file, timestamp, duration, ready }
        this.prefetchQueue = [];
        this.isRunning = false;
        this.lastError = null;
        
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
        await this.saveCheckpoint();
        console.log('⏹️  Stream fetcher stopped');
    }

    async generateSegments() {
        console.log('🎞️  Starting segment generation...');
        
        // Generate initial segments
        const segmentsToGenerate = Math.ceil(this.maxCacheSize / this.segmentDuration);
        
        // Fixed HLS-based pipeline for true continuity (no -re for faster prefetch)
        const hlsPlaylist = path.join(this.cacheDir, 'stream.m3u8');
        const ffmpegArgs = [
            '-hide_banner',
            '-loglevel', 'warning',
            '-reconnect', '1',
            '-reconnect_streamed', '1', 
            '-reconnect_delay_max', '30',
            '-i', this.videoUrl,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-g', `${this.segmentDuration * 15}`, // GOP size for 15fps
            '-force_key_frames', `expr:gte(t,n_forced*${this.segmentDuration})`,
            '-f', 'hls',
            '-hls_time', this.segmentDuration.toString(),
            '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments',
            '-hls_list_size', Math.ceil(this.maxCacheSize / this.segmentDuration), // Finite window matching cache
            '-hls_segment_type', 'mpegts',
            '-hls_segment_filename', path.join(this.cacheDir, 'segment_%d.ts'),
            hlsPlaylist
        ];

        const segmentProcess = spawn('ffmpeg', ffmpegArgs);
        
        segmentProcess.stderr.on('data', (data) => {
            const output = data.toString();
            if (output.includes('Opening') && output.includes('segment_')) {
                // New segment created
                const match = output.match(/segment_(\d+)\.ts/);
                if (match) {
                    const segmentId = parseInt(match[1]);
                    this.registerSegment(segmentId);
                }
            }
        });

        segmentProcess.on('close', (code) => {
            if (this.isRunning) {
                console.log(`⚠️  Segment generation exited with code ${code}, restarting...`);
                setTimeout(() => this.generateSegments(), 2000);
            }
        });

        segmentProcess.on('error', (error) => {
            console.error('❌ Segment generation error:', error.message);
            this.lastError = error.message;
        });
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
            
            console.log(`✅ Segment ${segmentId} ready (${(stats.size / 1024).toFixed(1)}KB)`);
            
            // Clean up old segments
            await this.cleanupOldSegments();
            
            // Save checkpoint periodically
            if (segmentId % 10 === 0) {
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