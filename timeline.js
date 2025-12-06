/**
 * Timeline Manager - Handles timeline rendering, zoom, and playhead
 */
export class TimelineManager {
    constructor(container, options = {}) {
        this.container = container;
        this.timeline = document.getElementById('timeline');
        this.ruler = document.getElementById('timeline-ruler');
        this.playhead = document.getElementById('playhead');
        this.playheadHandle = this.playhead.querySelector('.playhead-handle');

        this.duration = 0;
        this.currentTime = 0;
        this.zoom = 1;
        this.minZoom = 0.01;
        this.maxZoom = 10;
        this.pixelsPerSecond = 50; // Base pixels per second

        this.isDraggingPlayhead = false;
        this.onTimeChange = options.onTimeChange || (() => { });
        this.onTimeChangeEnd = options.onTimeChangeEnd || (() => { });

        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Playhead drag
        this.playheadHandle.addEventListener('mousedown', (e) => this.startPlayheadDrag(e));
        document.addEventListener('mousemove', (e) => this.onPlayheadDrag(e));
        document.addEventListener('mouseup', (e) => this.endPlayheadDrag(e));

        // Timeline click
        this.timeline.addEventListener('click', (e) => this.onTimelineClick(e));

        // Zoom with wheel
        this.container.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

        // Zoom buttons
        document.getElementById('zoom-in-btn').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoom-out-btn').addEventListener('click', () => this.zoomOut());

        // Zoom input - manual entry
        const zoomInput = document.getElementById('zoom-level');
        zoomInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value, 10);
            if (!isNaN(value) && value >= 1 && value <= 1000) {
                this.setZoom(value / 100);
            } else {
                e.target.value = Math.round(this.zoom * 100);
            }
        });
        zoomInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.target.blur();
            }
        });
    }

    setDuration(duration) {
        this.duration = duration;
        this.render();
    }

    setSegmentManager(segmentManager) {
        this.segmentManager = segmentManager;
    }

    setCurrentTime(time) {
        this.currentTime = Math.max(0, Math.min(time, this.duration));
        this.updatePlayhead();
    }

    getTimelineWidth() {
        return this.duration * this.pixelsPerSecond * this.zoom;
    }

    timeToPixels(time) {
        return time * this.pixelsPerSecond * this.zoom;
    }

    pixelsToTime(pixels) {
        return pixels / (this.pixelsPerSecond * this.zoom);
    }

    render() {
        const width = this.getTimelineWidth();
        this.timeline.style.width = `${Math.max(width, this.container.clientWidth - 40)}px`;

        this.renderRuler();
        this.updatePlayhead();
    }

    renderRuler() {
        this.ruler.innerHTML = '';

        // Calculate interval based on zoom
        let interval = 1; // seconds
        const minPixelsBetweenMarks = 80;

        while (this.timeToPixels(interval) < minPixelsBetweenMarks && interval < 3600) {
            if (interval < 5) interval = 5;
            else if (interval < 10) interval = 10;
            else if (interval < 30) interval = 30;
            else if (interval < 60) interval = 60;
            else if (interval < 300) interval = 300;
            else if (interval < 600) interval = 600;
            else interval = 3600;
        }

        while (this.timeToPixels(interval) > minPixelsBetweenMarks * 3 && interval > 0.1) {
            if (interval > 600) interval = 600;
            else if (interval > 300) interval = 300;
            else if (interval > 60) interval = 60;
            else if (interval > 30) interval = 30;
            else if (interval > 10) interval = 10;
            else if (interval > 5) interval = 5;
            else if (interval > 1) interval = 1;
            else interval = 0.5;
        }

        for (let t = 0; t <= this.duration; t += interval) {
            const mark = document.createElement('div');
            mark.className = 'ruler-mark major';
            mark.style.left = `${this.timeToPixels(t)}px`;
            mark.textContent = this.formatTime(t);
            this.ruler.appendChild(mark);
        }
    }

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    updatePlayhead() {
        const x = this.timeToPixels(this.currentTime);
        this.playhead.style.left = `${x}px`;
    }

    startPlayheadDrag(e) {
        e.preventDefault();
        e.stopPropagation();
        this.isDraggingPlayhead = true;
        this.playheadHandle.style.cursor = 'grabbing';
    }

    onPlayheadDrag(e) {
        if (!this.isDraggingPlayhead) return;

        const rect = this.timeline.getBoundingClientRect();
        // getBoundingClientRect already accounts for scroll position
        const x = e.clientX - rect.left;
        let time = this.pixelsToTime(x);

        // Check if playhead-to-segment snap is enabled
        const snapCheckbox = document.getElementById('snap-playhead-to-segment');
        const snapEnabled = snapCheckbox?.checked ?? true;

        if (snapEnabled && this.segmentManager) {
            const snapThreshold = this.pixelsToTime(10); // 10px snap threshold
            const segments = this.segmentManager.getSegments();

            for (const seg of segments) {
                // Snap to segment start
                if (Math.abs(time - seg.start) < snapThreshold) {
                    time = seg.start;
                    break;
                }
                // Snap to segment end
                if (Math.abs(time - seg.end) < snapThreshold) {
                    time = seg.end;
                    break;
                }
            }
        }

        this.setCurrentTime(time);
        this.onTimeChange(this.currentTime);
    }

    endPlayheadDrag(e) {
        if (!this.isDraggingPlayhead) return;

        this.isDraggingPlayhead = false;
        this.playheadHandle.style.cursor = 'grab';
        this.onTimeChangeEnd(this.currentTime);
    }

    onTimelineClick(e) {
        if (e.target.closest('.segment') || e.target.closest('.segment-handle')) return;
        if (e.target.closest('.playhead-handle')) return;

        const rect = this.timeline.getBoundingClientRect();
        // getBoundingClientRect already accounts for scroll position
        const x = e.clientX - rect.left;
        let time = this.pixelsToTime(x);

        // Check if playhead-to-segment snap is enabled
        const snapCheckbox = document.getElementById('snap-playhead-to-segment');
        const snapEnabled = snapCheckbox?.checked ?? true;

        if (snapEnabled && this.segmentManager) {
            const snapThreshold = this.pixelsToTime(10); // 10px snap threshold
            const segments = this.segmentManager.getSegments();

            for (const seg of segments) {
                // Snap to segment start
                if (Math.abs(time - seg.start) < snapThreshold) {
                    time = seg.start;
                    break;
                }
                // Snap to segment end
                if (Math.abs(time - seg.end) < snapThreshold) {
                    time = seg.end;
                    break;
                }
            }
        }

        this.setCurrentTime(time);
        this.onTimeChange(this.currentTime);
        this.onTimeChangeEnd(this.currentTime);
    }

    onWheel(e) {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.setZoom(this.zoom + delta);
        }
    }

    setZoom(newZoom) {
        const oldZoom = this.zoom;
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));

        if (oldZoom !== this.zoom) {
            document.getElementById('zoom-level').value = Math.round(this.zoom * 100);
            this.render();

            // Dispatch zoom change event for segments
            window.dispatchEvent(new CustomEvent('timelineZoomChange', {
                detail: { zoom: this.zoom }
            }));
        }
    }

    zoomIn() {
        this.setZoom(this.zoom + 0.25);
    }

    zoomOut() {
        // Limit button zoom out to 10%
        this.setZoom(Math.max(0.1, this.zoom - 0.25));
    }

    getCurrentTime() {
        return this.currentTime;
    }

    getDuration() {
        return this.duration;
    }

    getZoom() {
        return this.zoom;
    }

    getPixelsPerSecond() {
        return this.pixelsPerSecond * this.zoom;
    }
}
