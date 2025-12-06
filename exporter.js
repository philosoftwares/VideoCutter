/**
 * Video Exporter - Handles FFmpeg export with segments
 */
export class VideoExporter {
    constructor(ffmpeg, fetchFile) {
        this.ffmpeg = ffmpeg;
        this.fetchFile = fetchFile;
        this.isExporting = false;
        this.cancelled = false;

        this.onProgress = () => { };
        this.onStatusChange = () => { };
        this.onComplete = () => { };
        this.onError = () => { };
    }

    async export(videoFile, segments, videoDuration) {
        if (this.isExporting) {
            throw new Error('Export already in progress');
        }

        this.isExporting = true;
        this.cancelled = false;

        try {
            this.onStatusChange('Loading video file...');
            this.onProgress(5);

            // Get file extension for output
            const ext = this.getFileExtension(videoFile.name);
            const inputName = `input${ext}`;
            const outputName = `output${ext}`;

            // Write input file to FFmpeg filesystem
            const fileData = await this.fetchFile(videoFile);
            await this.ffmpeg.writeFile(inputName, fileData);

            if (this.cancelled) throw new Error('Export cancelled');

            this.onStatusChange('Processing segments...');
            this.onProgress(15);

            // Calculate what to export based on segments
            const exportRanges = this.calculateExportRanges(segments, videoDuration);

            if (exportRanges.length === 0) {
                throw new Error('No segments to export');
            }

            let result;

            if (exportRanges.length === 1) {
                // Single range - simple trim
                result = await this.trimSingle(inputName, outputName, exportRanges[0]);
            } else {
                // Multiple ranges - need to concat
                result = await this.trimAndConcat(inputName, outputName, exportRanges, ext);
            }

            if (this.cancelled) throw new Error('Export cancelled');

            this.onStatusChange('Finalizing...');
            this.onProgress(95);

            // Read output file
            const data = await this.ffmpeg.readFile(outputName);

            // Cleanup
            await this.ffmpeg.deleteFile(inputName);
            await this.ffmpeg.deleteFile(outputName);

            this.onProgress(100);
            this.isExporting = false;

            // Create blob and return
            const blob = new Blob([data.buffer], { type: this.getMimeType(ext) });

            // Generate filename: originalname_cut.ext
            const baseName = videoFile.name.replace(/\.[^.]+$/, '');
            const outputFilename = `${baseName}_cut${ext}`;

            this.onComplete(blob, outputFilename);

            return blob;

        } catch (error) {
            this.isExporting = false;

            if (error.message === 'Export cancelled') {
                this.onStatusChange('Export cancelled');
            } else {
                this.onError(error);
            }

            throw error;
        }
    }

    calculateExportRanges(segments, videoDuration) {
        // Sort segments by start time
        const sorted = [...segments].sort((a, b) => a.start - b.start);

        if (sorted.length === 0) {
            return [];
        }

        // Export logic:
        // - Only export video segments
        // - Gaps are skipped (not filled with blank)
        // - Gap from last segment to end -> NOT exported

        const ranges = [];

        // Add only video segments
        for (let i = 0; i < sorted.length; i++) {
            const seg = sorted[i];
            ranges.push({
                start: seg.start,
                end: seg.end,
                type: 'video'
            });
        }

        return ranges;
    }

    mergeRanges(ranges) {
        if (ranges.length === 0) return [];

        const merged = [ranges[0]];

        for (let i = 1; i < ranges.length; i++) {
            const last = merged[merged.length - 1];
            const current = ranges[i];

            if (Math.abs(last.end - current.start) < 0.01) {
                // Merge adjacent ranges
                last.end = current.end;
            } else {
                merged.push(current);
            }
        }

        return merged;
    }

    async trimSingle(inputName, outputName, range) {
        this.onStatusChange(`Trimming: ${this.formatTime(range.start)} - ${this.formatTime(range.end)}`);

        const duration = range.end - range.start;

        // Setup progress handler
        const progressHandler = ({ progress }) => {
            // Clamp progress to valid range (FFmpeg can report invalid values)
            const validProgress = Math.max(0, Math.min(1, progress || 0));
            const percent = 15 + (validProgress * 80);
            this.onProgress(Math.min(percent, 95));
        };
        this.ffmpeg.on('progress', progressHandler);

        try {
            // Use stream copy for fast export
            await this.ffmpeg.exec([
                '-ss', range.start.toFixed(3),
                '-i', inputName,
                '-t', duration.toFixed(3),
                '-c', 'copy',
                '-avoid_negative_ts', 'make_zero',
                outputName
            ]);
        } finally {
            // Remove progress handler to prevent accumulation
            this.ffmpeg.off('progress', progressHandler);
        }

        return outputName;
    }

    async trimAndConcat(inputName, outputName, ranges, ext) {
        const tempFiles = [];

        try {
            // Process each range
            for (let i = 0; i < ranges.length; i++) {
                if (this.cancelled) throw new Error('Export cancelled');

                const range = ranges[i];
                const tempName = `temp_${i}${ext}`;
                tempFiles.push(tempName);

                const duration = range.end - range.start;

                // Progress calculation - use closure to capture current index
                const baseProgress = 15 + (i / ranges.length) * 60;
                const progressHandler = ({ progress }) => {
                    // Clamp progress to valid range (FFmpeg can report invalid values)
                    const validProgress = Math.max(0, Math.min(1, progress || 0));
                    const percent = baseProgress + (validProgress * 60 / ranges.length);
                    this.onProgress(Math.min(percent, 85));
                };
                this.ffmpeg.on('progress', progressHandler);

                try {
                    // Trim video content from source using fast stream copy
                    this.onStatusChange(`Processing part ${i + 1}/${ranges.length}...`);

                    await this.ffmpeg.exec([
                        '-ss', range.start.toFixed(3),
                        '-i', inputName,
                        '-t', duration.toFixed(3),
                        '-c', 'copy',
                        '-avoid_negative_ts', 'make_zero',
                        tempName
                    ]);
                } finally {
                    // Remove progress handler to prevent accumulation
                    this.ffmpeg.off('progress', progressHandler);
                }
            }

            if (this.cancelled) throw new Error('Export cancelled');

            // Create concat file
            this.onStatusChange('Merging segments...');
            this.onProgress(85);

            const concatList = tempFiles.map(f => `file '${f}'`).join('\n');
            const encoder = new TextEncoder();
            await this.ffmpeg.writeFile('concat.txt', encoder.encode(concatList));

            // Progress handler for concat step (85% to 95%)
            const concatProgressHandler = ({ progress }) => {
                // Clamp progress to valid range (FFmpeg can report invalid values)
                const validProgress = Math.max(0, Math.min(1, progress || 0));
                const percent = 85 + (validProgress * 10);
                this.onProgress(Math.min(percent, 95));
            };
            this.ffmpeg.on('progress', concatProgressHandler);

            try {
                // Stream copy - fast concatenation
                await this.ffmpeg.exec([
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', 'concat.txt',
                    '-c', 'copy',
                    outputName
                ]);
            } finally {
                this.ffmpeg.off('progress', concatProgressHandler);
            }

            // Cleanup temp files
            for (const temp of tempFiles) {
                await this.ffmpeg.deleteFile(temp);
            }
            await this.ffmpeg.deleteFile('concat.txt');

            return outputName;

        } catch (error) {
            // Cleanup on error
            for (const temp of tempFiles) {
                try { await this.ffmpeg.deleteFile(temp); } catch { }
            }
            try { await this.ffmpeg.deleteFile('concat.txt'); } catch { }

            throw error;
        }
    }

    cancel() {
        this.cancelled = true;
    }

    getFileExtension(filename) {
        const match = filename.match(/\.[^.]+$/);
        return match ? match[0].toLowerCase() : '.mp4';
    }

    getMimeType(ext) {
        const mimeTypes = {
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mkv': 'video/x-matroska',
            '.avi': 'video/x-msvideo',
            '.mov': 'video/quicktime',
            '.m4v': 'video/x-m4v',
            '.3gp': 'video/3gpp',
            '.flv': 'video/x-flv'
        };
        return mimeTypes[ext] || 'video/mp4';
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
}
