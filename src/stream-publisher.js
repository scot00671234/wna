const { spawn } = require('child_process');
const path = require('path');

class StreamPublisher {
    constructor(endpoints, options = {}) {
        this.endpoints = endpoints; // [{ name, url, priority, active }]
        this.options = options;
        this.localRelayUrl = options.localRelayUrl || 'rtmp://localhost:1935/live_relay';
        
        this.publishers = new Map(); // endpoint -> process
        this.isRunning = false;
        this.lastError = null;
        this.stats = {
            activeConnections: 0,
            failedConnections: 0,
            bytesTransferred: 0,
            reconnects: 0
        };
    }

    async start(inputPath) {
        if (this.isRunning) {
            console.log('⚠️  Publisher already running');
            return;
        }
        
        this.isRunning = true;
        console.log('📡 Starting stream publisher...');
        console.log(`📥 Input: ${inputPath}`);
        console.log(`🎯 Direct streaming mode (no local relay)`);
        
        // Start direct publishers to external endpoints (skip local relay)
        for (const endpoint of this.endpoints.filter(e => e.active)) {
            await this.startDirectPublisher(endpoint, inputPath);
        }
    }

    async startLocalRelay(inputPath) {
        console.log('🔄 Starting local relay publisher with HLS input...');
        
        // Fixed: Use HLS input with proper tailing and monotonic timestamps
        const ffmpegArgs = [
            '-hide_banner',
            '-loglevel', 'info',
            '-re', // Read at native framerate for output
            '-f', 'hls',
            '-live_start_index', '-3', // Follow live edge, not beginning
            '-i', inputPath, // HLS playlist file  
            '-c', 'copy', // Copy without re-encoding to reduce latency
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
            this.localRelayUrl
        ];

        const relayProcess = spawn('ffmpeg', ffmpegArgs);
        this.publishers.set('local_relay', relayProcess);

        relayProcess.stderr.on('data', (data) => {
            const output = data.toString();
            if (output.includes('fps=')) {
                // Streaming successfully
                this.stats.activeConnections = Math.max(this.stats.activeConnections, 1);
            } else if (output.includes('error') || output.includes('failed')) {
                console.log(`⚠️  Relay: ${output.trim()}`);
            }
        });

        relayProcess.on('close', (code) => {
            console.log(`⚠️  Local relay exited with code ${code}`);
            this.publishers.delete('local_relay');
            
            if (this.isRunning) {
                console.log('🔄 Restarting local relay in 2 seconds...');
                setTimeout(() => this.startLocalRelay(inputPath), 2000);
            }
        });

        relayProcess.on('error', (error) => {
            console.error('❌ Local relay error:', error.message);
            this.lastError = error.message;
        });
    }

    async startDirectPublisher(endpoint, inputPath) {
        console.log(`📡 Starting direct publisher: ${endpoint.name} (Priority: ${endpoint.priority})`);
        
        // Stream directly from HLS to external RTMP endpoint
        let ffmpegArgs;
        
        // Quality ladder - use different settings based on endpoint priority
        if (endpoint.priority === 1) {
            // Primary endpoint - full quality
            ffmpegArgs = [
                '-hide_banner',
                '-loglevel', 'warning',
                '-re', // Read at native framerate for real-time streaming
                '-f', 'hls',
                '-live_start_index', '-3', // Follow live edge
                '-i', inputPath, // HLS playlist file
                '-c:v', 'libx264',
                '-preset', 'veryfast', 
                '-crf', '35', // Ultra-high CRF for minimal data
                '-maxrate', '200k', // Ultra-low bitrate
                '-bufsize', '400k',
                '-s', '320x240', // Tiny resolution
                '-r', '5', // Ultra-low framerate
                '-c:a', 'aac',
                '-b:a', '32k', // Minimal audio for speech
                '-ar', '16000', // Lower sample rate
                '-ac', '1', // Mono audio
                '-f', 'flv',
                '-flvflags', 'no_duration_filesize',
                '-rtmp_live', 'live',
                '-rtmp_buffer', '2000',
                endpoint.url
            ];
        } else {
            // Backup endpoint - lower quality for reliability
            ffmpegArgs = [
                '-hide_banner',
                '-loglevel', 'warning',
                '-re',
                '-f', 'hls',
                '-live_start_index', '-3',
                '-i', inputPath,
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-crf', '38', // Maximum CRF for backup
                '-maxrate', '128k', // Absolute minimum bitrate
                '-bufsize', '256k',
                '-s', '240x180', // Minimal resolution
                '-r', '3', // Minimal framerate
                '-c:a', 'aac',
                '-b:a', '24k', // Minimal audio for backup
                '-ar', '16000',
                '-ac', '1', // Mono
                '-f', 'flv', 
                '-flvflags', 'no_duration_filesize',
                '-rtmp_live', 'live',
                '-rtmp_buffer', '1000',
                endpoint.url
            ];
        }

        console.log(`🔧 Direct streaming command: ffmpeg ${ffmpegArgs.join(' ')}`);

        const publisherProcess = spawn('ffmpeg', ffmpegArgs);
        this.publishers.set(endpoint.name, publisherProcess);

        let isConnected = false;
        let reconnectAttempts = 0;
        const maxReconnects = 10;

        publisherProcess.stderr.on('data', (data) => {
            const output = data.toString();
            
            // PRODUCTION: Only log errors and initial connection
            if (output.includes('error') || output.includes('failed') || output.includes('Connection refused')) {
                console.log(`📺 ${endpoint.name}: ${output.trim()}`);
            } else if (output.includes('fps=') && !isConnected) {
                console.log(`✅ ${endpoint.name}: Connected`);
            }
            
            if (output.includes('fps=') && !isConnected) {
                isConnected = true;
                this.stats.activeConnections++;
                console.log(`✅ ${endpoint.name}: Connected and streaming to external RTMP`);
                reconnectAttempts = 0; // Reset on successful connection
            } else if (output.includes('Connection refused') || 
                      output.includes('error') ||
                      output.includes('failed')) {
                console.log(`⚠️  ${endpoint.name}: ${output.trim()}`);
            }
        });

        publisherProcess.on('close', (code) => {
            console.log(`⚠️  ${endpoint.name} exited with code ${code}`);
            this.publishers.delete(endpoint.name);
            isConnected = false;
            this.stats.activeConnections = Math.max(0, this.stats.activeConnections - 1);
            
            if (this.isRunning && endpoint.active) {
                reconnectAttempts++;
                if (reconnectAttempts <= maxReconnects) {
                    const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempts - 1), 30000);
                    console.log(`🔄 ${endpoint.name}: Reconnecting in ${delay/1000}s (attempt ${reconnectAttempts}/${maxReconnects})`);
                    setTimeout(() => this.startDirectPublisher(endpoint, inputPath), delay);
                    this.stats.reconnects++;
                } else {
                    console.log(`❌ ${endpoint.name}: Max reconnect attempts reached, marking inactive`);
                    endpoint.active = false;
                    this.stats.failedConnections++;
                }
            }
        });

        publisherProcess.on('error', (error) => {
            console.error(`❌ ${endpoint.name} error:`, error.message);
            this.lastError = error.message;
        });
    }

    async startPublisher(endpoint) {
        console.log(`📡 Starting publisher: ${endpoint.name} (Priority: ${endpoint.priority})`);
        
        // Pull from local relay and push to external endpoint with quality options
        let ffmpegArgs;
        
        // Quality ladder - use different settings based on endpoint priority
        if (endpoint.priority === 1) {
            // Primary endpoint - full quality
            ffmpegArgs = [
                '-hide_banner',
                '-loglevel', 'warning',
                '-i', this.localRelayUrl,
                '-c:v', 'libx264',
                '-preset', 'veryfast', 
                '-crf', '23',
                '-maxrate', '2M',
                '-bufsize', '4M',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-f', 'flv',
                '-flvflags', 'no_duration_filesize',
                '-rtmp_live', 'live',
                '-rtmp_buffer', '2000',
                endpoint.url
            ];
        } else {
            // Backup endpoint - lower quality for reliability
            ffmpegArgs = [
                '-hide_banner',
                '-loglevel', 'warning',
                '-i', this.localRelayUrl,
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-crf', '28',
                '-maxrate', '1M',
                '-bufsize', '2M',
                '-s', '640x360', // Lower resolution
                '-c:a', 'aac',
                '-b:a', '96k',
                '-f', 'flv', 
                '-flvflags', 'no_duration_filesize',
                '-rtmp_live', 'live',
                '-rtmp_buffer', '1000',
                endpoint.url
            ];
        }

        const publisherProcess = spawn('ffmpeg', ffmpegArgs);
        this.publishers.set(endpoint.name, publisherProcess);

        let isConnected = false;
        let reconnectAttempts = 0;
        const maxReconnects = 10;

        publisherProcess.stderr.on('data', (data) => {
            const output = data.toString();
            
            if (output.includes('fps=') && !isConnected) {
                isConnected = true;
                this.stats.activeConnections++;
                console.log(`✅ ${endpoint.name}: Connected and streaming`);
                reconnectAttempts = 0; // Reset on successful connection
            } else if (output.includes('Connection refused') || output.includes('error')) {
                console.log(`⚠️  ${endpoint.name}: ${output.trim()}`);
            }
        });

        publisherProcess.on('close', (code) => {
            console.log(`⚠️  ${endpoint.name} exited with code ${code}`);
            this.publishers.delete(endpoint.name);
            isConnected = false;
            this.stats.activeConnections = Math.max(0, this.stats.activeConnections - 1);
            
            if (this.isRunning && endpoint.active) {
                reconnectAttempts++;
                if (reconnectAttempts <= maxReconnects) {
                    const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempts - 1), 30000);
                    console.log(`🔄 ${endpoint.name}: Reconnecting in ${delay/1000}s (attempt ${reconnectAttempts}/${maxReconnects})`);
                    setTimeout(() => this.startPublisher(endpoint), delay);
                    this.stats.reconnects++;
                } else {
                    console.log(`❌ ${endpoint.name}: Max reconnect attempts reached, marking inactive`);
                    endpoint.active = false;
                    this.stats.failedConnections++;
                }
            }
        });

        publisherProcess.on('error', (error) => {
            console.error(`❌ ${endpoint.name} error:`, error.message);
            this.lastError = error.message;
        });
    }

    async stop() {
        console.log('⏹️  Stopping all publishers...');
        this.isRunning = false;
        
        for (const [name, process] of this.publishers.entries()) {
            console.log(`🛑 Stopping ${name}...`);
            process.kill('SIGTERM');
        }
        
        // Wait for processes to terminate
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        this.publishers.clear();
        this.stats.activeConnections = 0;
        console.log('✅ All publishers stopped');
    }

    addEndpoint(endpoint) {
        this.endpoints.push(endpoint);
        if (this.isRunning && endpoint.active) {
            this.startPublisher(endpoint);
        }
    }

    removeEndpoint(name) {
        const process = this.publishers.get(name);
        if (process) {
            process.kill('SIGTERM');
            this.publishers.delete(name);
        }
        
        this.endpoints = this.endpoints.filter(e => e.name !== name);
    }

    setEndpointActive(name, active) {
        const endpoint = this.endpoints.find(e => e.name === name);
        if (endpoint) {
            endpoint.active = active;
            
            if (active && this.isRunning) {
                this.startPublisher(endpoint);
            } else if (!active) {
                const process = this.publishers.get(name);
                if (process) {
                    process.kill('SIGTERM');
                    this.publishers.delete(name);
                }
            }
        }
    }

    getStats() {
        return {
            isRunning: this.isRunning,
            activePublishers: this.publishers.size,
            endpoints: this.endpoints.map(e => ({
                name: e.name,
                priority: e.priority,
                active: e.active,
                connected: this.publishers.has(e.name)
            })),
            stats: this.stats,
            lastError: this.lastError
        };
    }

    // Quality fallback - switch to lower quality endpoint
    async fallbackQuality() {
        console.log('⬇️  Triggering quality fallback...');
        
        // Find backup endpoints
        const backupEndpoints = this.endpoints
            .filter(e => e.name.includes('backup') || e.priority > 1)
            .sort((a, b) => a.priority - b.priority);
        
        if (backupEndpoints.length > 0) {
            // Activate backup endpoint
            for (const endpoint of backupEndpoints) {
                if (!endpoint.active) {
                    console.log(`🔄 Activating backup endpoint: ${endpoint.name}`);
                    this.setEndpointActive(endpoint.name, true);
                    break;
                }
            }
            
            // Optionally deactivate primary endpoint
            const primaryEndpoints = this.endpoints.filter(e => e.priority === 1);
            for (const endpoint of primaryEndpoints) {
                if (endpoint.active) {
                    console.log(`⏸️  Pausing primary endpoint: ${endpoint.name}`);
                    this.setEndpointActive(endpoint.name, false);
                    break;
                }
            }
        }
    }

    // Restore quality - switch back to higher quality
    async restoreQuality() {
        console.log('⬆️  Attempting quality restoration...');
        
        const primaryEndpoints = this.endpoints
            .filter(e => e.priority === 1)
            .sort((a, b) => a.priority - b.priority);
        
        if (primaryEndpoints.length > 0) {
            const primary = primaryEndpoints[0];
            if (!primary.active) {
                console.log(`🔄 Restoring primary endpoint: ${primary.name}`);
                this.setEndpointActive(primary.name, true);
                
                // Wait a bit then deactivate backup
                setTimeout(() => {
                    const backupEndpoints = this.endpoints.filter(e => e.priority > 1 && e.active);
                    if (backupEndpoints.length > 0) {
                        console.log(`⏸️  Deactivating backup endpoint: ${backupEndpoints[0].name}`);
                        this.setEndpointActive(backupEndpoints[0].name, false);
                    }
                }, 10000); // Wait 10 seconds before switching back
            }
        }
    }
}

module.exports = StreamPublisher;