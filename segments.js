/**
 * Segment Manager - Handles video segments (cut, resize, move, delete)
 */
export class SegmentManager {
    constructor(timelineManager) {
        this.timelineManager = timelineManager;
        this.container = document.getElementById('timeline-segments');
        this.segments = [];
        this.selectedSegment = null;
        this.nextId = 1;

        this.dragState = null;
        this.minSegmentDuration = 0.1; // seconds

        this.onSegmentChange = () => { };
        this.onSelectionChange = () => { };

        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    /**
     * Create a full segment covering the entire video duration
     */
    createFullSegment(duration) {
        const segment = {
            id: this.nextId++,
            start: 0,
            end: duration
        };
        this.segments = [segment];
        this.renderAll();
        this.onSegmentChange();
        return segment;
    }

    setupEventListeners() {
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('mouseup', (e) => this.onMouseUp(e));

        // Listen for zoom changes
        window.addEventListener('timelineZoomChange', () => this.renderAll());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.selectedSegment && !e.target.matches('input, textarea')) {
                    e.preventDefault();
                    this.deleteSegment(this.selectedSegment.id);
                }
            }
        });

        // Click outside to deselect
        document.getElementById('timeline').addEventListener('click', (e) => {
            if (!e.target.closest('.segment')) {
                this.selectSegment(null);
            }
        });
    }

    /**
     * Split the segment at the given time position into two segments
     */
    splitSegmentAtTime(time) {
        // Find segment that contains this time
        const segment = this.segments.find(s => time > s.start + this.minSegmentDuration && time < s.end - this.minSegmentDuration);

        if (!segment) {
            console.warn('Cannot split: no segment at this position or too close to edge');
            return null;
        }

        // Store original end
        const originalEnd = segment.end;

        // Modify existing segment to end at cut position
        segment.end = time;

        // Create new segment from cut position to original end
        const newSegment = {
            id: this.nextId++,
            start: time,
            end: originalEnd
        };

        this.segments.push(newSegment);
        this.sortSegments();
        this.renderAll();
        this.selectSegment(newSegment.id);
        this.onSegmentChange();

        return newSegment;
    }

    findNonOverlappingPosition(start, end) {
        const duration = this.timelineManager.getDuration();

        // Check if position is valid
        if (start < 0) start = 0;
        if (end > duration) end = duration;
        if (end - start < this.minSegmentDuration) return null;

        // Check for overlaps
        for (const seg of this.segments) {
            if (this.overlaps(start, end, seg.start, seg.end)) {
                // Try to find space after this segment
                start = seg.end;
                end = start + (end - start);
                if (end > duration) {
                    end = duration;
                    if (end - start < this.minSegmentDuration) return null;
                }
            }
        }

        // Final overlap check
        for (const seg of this.segments) {
            if (this.overlaps(start, end, seg.start, seg.end)) {
                return null;
            }
        }

        return { start, end };
    }

    overlaps(start1, end1, start2, end2) {
        return start1 < end2 && end1 > start2;
    }

    deleteSegment(id) {
        const index = this.segments.findIndex(s => s.id === id);
        if (index !== -1) {
            this.segments.splice(index, 1);
            if (this.selectedSegment && this.selectedSegment.id === id) {
                this.selectSegment(null);
            }
            this.renderAll();
            this.onSegmentChange();
        }
    }

    selectSegment(id) {
        this.selectedSegment = id ? this.segments.find(s => s.id === id) : null;

        // Update visual selection
        this.container.querySelectorAll('.segment').forEach(el => {
            el.classList.toggle('selected', el.dataset.id == id);
        });

        // Update delete button state
        document.getElementById('delete-segment-btn').disabled = !this.selectedSegment;

        this.onSelectionChange(this.selectedSegment);
    }

    sortSegments() {
        this.segments.sort((a, b) => a.start - b.start);
    }

    renderAll() {
        this.container.innerHTML = '';
        this.segments.forEach(seg => this.renderSegment(seg));
    }

    renderSegment(segment) {
        const el = document.createElement('div');
        el.className = 'segment';
        el.dataset.id = segment.id;

        if (this.selectedSegment && this.selectedSegment.id === segment.id) {
            el.classList.add('selected');
        }

        const left = this.timelineManager.timeToPixels(segment.start);
        const width = this.timelineManager.timeToPixels(segment.end - segment.start);

        el.style.left = `${left}px`;
        el.style.width = `${width}px`;

        // Label
        const label = document.createElement('span');
        label.className = 'segment-label';
        label.textContent = `${this.formatDuration(segment.end - segment.start)}`;
        el.appendChild(label);

        // Resize handles
        const leftHandle = document.createElement('div');
        leftHandle.className = 'segment-handle left';
        el.appendChild(leftHandle);

        const rightHandle = document.createElement('div');
        rightHandle.className = 'segment-handle right';
        el.appendChild(rightHandle);

        // Event listeners
        el.addEventListener('mousedown', (e) => this.onSegmentMouseDown(e, segment));
        leftHandle.addEventListener('mousedown', (e) => this.onHandleMouseDown(e, segment, 'left'));
        rightHandle.addEventListener('mousedown', (e) => this.onHandleMouseDown(e, segment, 'right'));

        this.container.appendChild(el);
    }

    formatDuration(seconds) {
        if (seconds < 60) {
            return `${seconds.toFixed(1)}s`;
        }
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    onSegmentMouseDown(e, segment) {
        if (e.target.classList.contains('segment-handle')) return;

        e.preventDefault();
        e.stopPropagation();

        this.selectSegment(segment.id);

        const rect = this.container.getBoundingClientRect();
        const startX = e.clientX;
        const startLeft = segment.start;

        this.dragState = {
            type: 'move',
            segment,
            startX,
            startLeft,
            startRight: segment.end
        };

        e.target.classList.add('dragging');
    }

    onHandleMouseDown(e, segment, handle) {
        e.preventDefault();
        e.stopPropagation();

        this.selectSegment(segment.id);

        this.dragState = {
            type: 'resize',
            segment,
            handle,
            startX: e.clientX,
            startLeft: segment.start,
            startRight: segment.end
        };
    }

    onMouseMove(e) {
        if (!this.dragState) return;

        const deltaX = e.clientX - this.dragState.startX;
        const deltaTime = this.timelineManager.pixelsToTime(deltaX);
        const duration = this.timelineManager.getDuration();
        const segment = this.dragState.segment;

        if (this.dragState.type === 'move') {
            let newStart = this.dragState.startLeft + deltaTime;
            let newEnd = this.dragState.startRight + deltaTime;
            const segmentDuration = newEnd - newStart;

            // Boundary constraints
            if (newStart < 0) {
                newStart = 0;
                newEnd = segmentDuration;
            }
            if (newEnd > duration) {
                newEnd = duration;
                newStart = duration - segmentDuration;
            }

            // Collision detection
            const collision = this.checkCollision(segment.id, newStart, newEnd);
            if (!collision) {
                segment.start = newStart;
                segment.end = newEnd;
                this.sortSegments();
                this.renderAll();
            }
        } else if (this.dragState.type === 'resize') {
            if (this.dragState.handle === 'left') {
                let newStart = this.dragState.startLeft + deltaTime;

                // Constraints
                newStart = Math.max(0, newStart);
                newStart = Math.min(segment.end - this.minSegmentDuration, newStart);

                // Collision check
                const collision = this.checkCollision(segment.id, newStart, segment.end);
                if (!collision) {
                    segment.start = newStart;
                    this.renderAll();
                }
            } else {
                let newEnd = this.dragState.startRight + deltaTime;

                // Constraints
                newEnd = Math.min(duration, newEnd);
                newEnd = Math.max(segment.start + this.minSegmentDuration, newEnd);

                // Collision check
                const collision = this.checkCollision(segment.id, segment.start, newEnd);
                if (!collision) {
                    segment.end = newEnd;
                    this.renderAll();
                }
            }
        }
    }

    onMouseUp(e) {
        if (this.dragState) {
            const el = this.container.querySelector(`.segment[data-id="${this.dragState.segment.id}"]`);
            if (el) el.classList.remove('dragging');

            this.dragState = null;
            this.onSegmentChange();
        }
    }

    checkCollision(excludeId, start, end) {
        for (const seg of this.segments) {
            if (seg.id === excludeId) continue;
            if (this.overlaps(start, end, seg.start, seg.end)) {
                return seg;
            }
        }
        return null;
    }

    getSegments() {
        return [...this.segments].sort((a, b) => a.start - b.start);
    }

    getSegmentCount() {
        return this.segments.length;
    }

    clearAll() {
        this.segments = [];
        this.selectedSegment = null;
        this.renderAll();
        this.onSegmentChange();
    }

    hasSegments() {
        return this.segments.length > 0;
    }
}
