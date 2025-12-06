/**
 * VideoCutter - Main Application
 * Using FFmpeg.wasm with local files (no SharedArrayBuffer required)
 */
import { TimelineManager } from './timeline.js';
import { SegmentManager } from './segments.js';
import { VideoExporter } from './exporter.js';

// Get FFmpeg from global (loaded via UMD scripts)
const { FFmpeg } = FFmpegWASM;
const { fetchFile } = FFmpegUtil;

class VideoCutterApp {
    constructor() {
        this.ffmpeg = null;
        this.ffmpegLoaded = false;
        this.fetchFile = fetchFile;

        this.videoFile = null;
        this.videoPlayer = document.getElementById('video-player');
        this.videoDuration = 0;

        this.timelineManager = null;
        this.segmentManager = null;
        this.exporter = null;

        this.exportedBlob = null;
        this.exportedFilename = null;

        this.init();
    }

    async init() {
        this.setupScreens();
        this.setupDropZone();
        this.setupVideoPlayer();
        this.setupToolbar();
        this.setupExportScreen();
        this.setupCompleteScreen();
        this.setupKeyboardShortcuts();

        // Initialize FFmpeg in background
        this.loadFFmpeg();
    }

    async loadFFmpeg() {
        const loading = document.getElementById('loading-ffmpeg');

        try {
            loading.classList.remove('hidden');
            loading.querySelector('p').textContent = 'Loading FFmpeg (first time may take a moment)...';

            this.ffmpeg = new FFmpeg();

            this.ffmpeg.on('log', ({ message }) => {
                console.log('[FFmpeg]', message);
            });

            // Load using local files only
            // Without SharedArrayBuffer, FFmpeg will run in single-threaded mode
            const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
            console.log('SharedArrayBuffer available:', hasSharedArrayBuffer);

            await this.ffmpeg.load({
                coreURL: '/ffmpeg-core/ffmpeg-core.js',
                wasmURL: '/ffmpeg-core/ffmpeg-core.wasm'
            });

            this.ffmpegLoaded = true;
            loading.classList.add('hidden');
            console.log('FFmpeg loaded successfully (single-threaded mode)');

        } catch (error) {
            console.error('Failed to load FFmpeg:', error);
            loading.querySelector('p').innerHTML = `
                <span style="color: #ef4444;">Failed to load FFmpeg</span><br>
                <small style="color: #a1a1aa;">${error.message}</small><br>
                <small style="color: #71717a;">Make sure to run: node server.js</small>
            `;
        }
    }

    // ===== Screen Management =====

    setupScreens() {
        this.screens = {
            upload: document.getElementById('upload-screen'),
            editor: document.getElementById('editor-screen'),
            export: document.getElementById('export-screen'),
            complete: document.getElementById('complete-screen')
        };
    }

    showScreen(name) {
        Object.values(this.screens).forEach(screen => {
            screen.classList.remove('active');
        });
        this.screens[name].classList.add('active');
    }

    // ===== Drop Zone =====

    setupDropZone() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');
        const browseBtn = document.getElementById('browse-btn');

        // Click to browse
        browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });

        dropZone.addEventListener('click', () => {
            fileInput.click();
        });

        // File input change
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleVideoFile(e.target.files[0]);
            }
        });

        // Drag and drop
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');

            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type.startsWith('video/')) {
                this.handleVideoFile(files[0]);
            }
        });
    }

    async handleVideoFile(file) {
        const loading = document.getElementById('loading-ffmpeg');

        // Show loading if FFmpeg not ready
        if (!this.ffmpegLoaded) {
            loading.classList.remove('hidden');
            loading.querySelector('p').textContent = 'Waiting for FFmpeg...';

            // Wait for FFmpeg to load (max 60 seconds)
            let waited = 0;
            while (!this.ffmpegLoaded && waited < 60000) {
                await new Promise(r => setTimeout(r, 100));
                waited += 100;
            }

            if (!this.ffmpegLoaded) {
                return; // Error message should already be shown
            }

            loading.classList.add('hidden');
        }

        this.videoFile = file;

        // Set video source
        const url = URL.createObjectURL(file);
        this.videoPlayer.src = url;

        // Wait for metadata
        await new Promise((resolve) => {
            this.videoPlayer.onloadedmetadata = resolve;
        });

        this.videoDuration = this.videoPlayer.duration;

        // Update UI
        document.getElementById('file-name').textContent = file.name;
        document.getElementById('file-duration').textContent = this.formatTime(this.videoDuration);
        document.getElementById('total-duration').textContent = this.formatTime(this.videoDuration);

        // Initialize timeline
        this.initializeTimeline();

        // Show editor
        this.showScreen('editor');
    }

    initializeTimeline() {
        const container = document.getElementById('timeline-container');

        // Create timeline manager
        this.timelineManager = new TimelineManager(container, {
            onTimeChange: (time) => this.onTimelineTimeChange(time),
            onTimeChangeEnd: (time) => this.onTimelineTimeChangeEnd(time)
        });

        this.timelineManager.setDuration(this.videoDuration);

        // Create segment manager
        this.segmentManager = new SegmentManager(this.timelineManager);
        this.segmentManager.onSegmentChange = () => this.updateSegmentCount();

        // Create initial full segment covering entire video
        this.segmentManager.createFullSegment(this.videoDuration);

        // Create exporter
        this.exporter = new VideoExporter(this.ffmpeg, this.fetchFile);

        this.updateSegmentCount();
    }

    // ===== Video Player =====

    setupVideoPlayer() {
        const playPauseBtn = document.getElementById('play-pause-btn');
        const iconPlay = playPauseBtn.querySelector('.icon-play');
        const iconPause = playPauseBtn.querySelector('.icon-pause');

        playPauseBtn.addEventListener('click', () => {
            if (this.videoPlayer.paused) {
                this.videoPlayer.play();
            } else {
                this.videoPlayer.pause();
            }
        });

        this.videoPlayer.addEventListener('play', () => {
            iconPlay.classList.add('hidden');
            iconPause.classList.remove('hidden');
        });

        this.videoPlayer.addEventListener('pause', () => {
            iconPlay.classList.remove('hidden');
            iconPause.classList.add('hidden');
        });

        this.videoPlayer.addEventListener('timeupdate', () => {
            const time = this.videoPlayer.currentTime;
            document.getElementById('current-time').textContent = this.formatTime(time);

            if (this.timelineManager && !this.timelineManager.isDraggingPlayhead) {
                this.timelineManager.setCurrentTime(time);
            }
        });
    }

    onTimelineTimeChange(time) {
        // Real-time preview while dragging
        this.videoPlayer.currentTime = time;
        document.getElementById('current-time').textContent = this.formatTime(time);
    }

    onTimelineTimeChangeEnd(time) {
        this.videoPlayer.currentTime = time;
    }

    // ===== Toolbar =====

    setupToolbar() {
        // Scissors button - splits segment at playhead
        document.getElementById('scissors-btn').addEventListener('click', () => {
            if (this.segmentManager && this.timelineManager) {
                const time = this.timelineManager.getCurrentTime();
                this.segmentManager.splitSegmentAtTime(time);
            }
        });

        // Delete button
        document.getElementById('delete-segment-btn').addEventListener('click', () => {
            if (this.segmentManager && this.segmentManager.selectedSegment) {
                this.segmentManager.deleteSegment(this.segmentManager.selectedSegment.id);
            }
        });

        // Back button
        document.getElementById('back-btn').addEventListener('click', () => {
            this.resetEditor();
        });

        // Export button
        document.getElementById('export-btn').addEventListener('click', () => {
            this.startExport();
        });
    }

    updateSegmentCount() {
        const count = this.segmentManager ? this.segmentManager.getSegmentCount() : 0;
        document.getElementById('segments-count').textContent =
            count === 0 ? '0 segments' :
                count === 1 ? '1 segment' :
                    `${count} segments`;
    }

    // ===== Export =====

    setupExportScreen() {
        document.getElementById('cancel-export-btn').addEventListener('click', () => {
            if (this.exporter) {
                this.exporter.cancel();
            }
            this.showScreen('editor');
        });
    }

    async startExport() {
        if (!this.segmentManager || !this.segmentManager.hasSegments()) {
            alert('Please create at least one segment before exporting.');
            return;
        }

        this.showScreen('export');

        const progressFill = document.querySelector('#export-progress .progress-fill');
        const percentText = document.getElementById('export-percent');
        const statusText = document.getElementById('export-status');

        // Reset progress
        progressFill.style.width = '0%';
        percentText.textContent = '0%';

        this.exporter.onProgress = (percent) => {
            progressFill.style.width = `${percent}%`;
            percentText.textContent = `${Math.round(percent)}%`;
        };

        this.exporter.onStatusChange = (status) => {
            statusText.textContent = status;
        };

        this.exporter.onComplete = (blob, filename) => {
            this.exportedBlob = blob;
            this.exportedFilename = filename;
            document.getElementById('export-filename').textContent = filename;
            this.showScreen('complete');
        };

        this.exporter.onError = (error) => {
            console.error('Export error:', error);
            alert('Export failed: ' + error.message);
            this.showScreen('editor');
        };

        try {
            await this.exporter.export(
                this.videoFile,
                this.segmentManager.getSegments(),
                this.videoDuration
            );
        } catch (error) {
            if (error.message !== 'Export cancelled') {
                console.error('Export error:', error);
            }
        }
    }

    // ===== Complete Screen =====

    setupCompleteScreen() {
        document.getElementById('download-btn').addEventListener('click', () => {
            if (this.exportedBlob && this.exportedFilename) {
                this.downloadBlob(this.exportedBlob, this.exportedFilename);
            }
        });

        document.getElementById('edit-again-btn').addEventListener('click', () => {
            this.showScreen('editor');
        });

        document.getElementById('new-video-btn').addEventListener('click', () => {
            this.resetEditor();
        });
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    resetEditor() {
        // Clear video
        this.videoPlayer.pause();
        this.videoPlayer.src = '';
        this.videoFile = null;

        // Clear segments
        if (this.segmentManager) {
            this.segmentManager.clearAll();
        }

        // Reset file input
        document.getElementById('file-input').value = '';

        // Show upload screen
        this.showScreen('upload');
    }

    // ===== Keyboard Shortcuts =====

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ignore if typing in input
            if (e.target.matches('input, textarea')) return;

            switch (e.key.toLowerCase()) {
                case ' ':
                    e.preventDefault();
                    if (this.videoPlayer.paused) {
                        this.videoPlayer.play();
                    } else {
                        this.videoPlayer.pause();
                    }
                    break;

                case 'c':
                    if (this.segmentManager && this.timelineManager) {
                        const time = this.timelineManager.getCurrentTime();
                        this.segmentManager.splitSegmentAtTime(time);
                    }
                    break;

                case 'arrowleft':
                    e.preventDefault();
                    this.videoPlayer.currentTime = Math.max(0, this.videoPlayer.currentTime - 5);
                    break;

                case 'arrowright':
                    e.preventDefault();
                    this.videoPlayer.currentTime = Math.min(this.videoDuration, this.videoPlayer.currentTime + 5);
                    break;
            }
        });
    }

    // ===== Utilities =====

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        if (h > 0) {
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new VideoCutterApp();
});
