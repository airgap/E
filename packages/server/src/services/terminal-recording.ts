/**
 * Terminal Session Recording Service
 *
 * Records terminal sessions in asciicast v2 format for
 * later playback and review.
 */

import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join, basename } from 'path';
import { nanoid } from 'nanoid';
import type {
  TerminalRecording,
  AsciicastHeader,
  AsciicastEvent,
  RecordingConfig,
} from '@e/shared';
import { DEFAULT_RECORDING_CONFIG } from '@e/shared';

class TerminalRecordingService {
  private static instance: TerminalRecordingService;
  private config: RecordingConfig = { ...DEFAULT_RECORDING_CONFIG };
  private activeRecordings = new Map<
    string,
    {
      recording: TerminalRecording;
      events: AsciicastEvent[];
      startTime: number;
    }
  >();

  static getInstance(): TerminalRecordingService {
    if (!TerminalRecordingService.instance) {
      TerminalRecordingService.instance = new TerminalRecordingService();
    }
    return TerminalRecordingService.instance;
  }

  setConfig(config: Partial<RecordingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): RecordingConfig {
    return { ...this.config };
  }

  /**
   * Start recording a terminal session.
   */
  startRecording(sessionId: string, cols: number, rows: number, title?: string): TerminalRecording {
    const id = nanoid(12);
    const outputDir = this.config.outputDir;
    mkdirSync(outputDir, { recursive: true });
    const filePath = join(outputDir, `${id}.cast`);
    const now = Date.now();

    const recording: TerminalRecording = {
      id,
      sessionId,
      status: 'recording',
      filePath,
      startedAt: now,
      eventCount: 0,
      cols,
      rows,
      title,
    };

    // Write asciicast header
    const header: AsciicastHeader = {
      version: 2,
      width: cols,
      height: rows,
      timestamp: Math.floor(now / 1000),
      title,
    };
    writeFileSync(filePath, JSON.stringify(header) + '\n');

    this.activeRecordings.set(id, { recording, events: [], startTime: now });
    return recording;
  }

  /**
   * Record a terminal output event.
   */
  recordOutput(recordingId: string, data: string): void {
    const active = this.activeRecordings.get(recordingId);
    if (!active || active.recording.status !== 'recording') return;

    // Check limits
    if (this.config.maxDurationSeconds > 0) {
      const elapsed = (Date.now() - active.startTime) / 1000;
      if (elapsed >= this.config.maxDurationSeconds) {
        this.stopRecording(recordingId);
        return;
      }
    }

    const event: AsciicastEvent = {
      time: (Date.now() - active.startTime) / 1000,
      type: 'o',
      data,
    };

    active.events.push(event);
    active.recording.eventCount++;

    // Append to file (asciicast v2 format: [time, type, data])
    const line = JSON.stringify([event.time, event.type, event.data]);
    try {
      const fd = Bun.file(active.recording.filePath);
      writeFileSync(active.recording.filePath, line + '\n', { flag: 'a' });
    } catch {}

    // Check file size
    if (this.config.maxFileSizeBytes > 0) {
      try {
        const stat = statSync(active.recording.filePath);
        if (stat.size >= this.config.maxFileSizeBytes) {
          this.stopRecording(recordingId);
        }
      } catch {}
    }
  }

  /**
   * Record terminal input.
   */
  recordInput(recordingId: string, data: string): void {
    const active = this.activeRecordings.get(recordingId);
    if (!active || active.recording.status !== 'recording') return;

    const event: AsciicastEvent = {
      time: (Date.now() - active.startTime) / 1000,
      type: 'i',
      data,
    };
    active.events.push(event);
    active.recording.eventCount++;

    const line = JSON.stringify([event.time, event.type, event.data]);
    try {
      writeFileSync(active.recording.filePath, line + '\n', { flag: 'a' });
    } catch {}
  }

  /**
   * Stop recording a session.
   */
  stopRecording(recordingId: string): TerminalRecording | null {
    const active = this.activeRecordings.get(recordingId);
    if (!active) return null;

    active.recording.status = 'stopped';
    active.recording.stoppedAt = Date.now();
    active.recording.durationSeconds = Math.round((Date.now() - active.startTime) / 1000);

    try {
      const stat = statSync(active.recording.filePath);
      active.recording.fileSize = stat.size;
    } catch {}

    this.activeRecordings.delete(recordingId);
    return active.recording;
  }

  /**
   * List all recordings.
   */
  listRecordings(): TerminalRecording[] {
    const recordings: TerminalRecording[] = [];

    // Active recordings
    for (const [, active] of this.activeRecordings) {
      recordings.push(active.recording);
    }

    // Saved recordings on disk
    const dir = this.config.outputDir;
    if (!existsSync(dir)) return recordings;

    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.cast'));
      for (const file of files) {
        const id = basename(file, '.cast');
        if (this.activeRecordings.has(id)) continue; // Already included

        const filePath = join(dir, file);
        try {
          const content = readFileSync(filePath, 'utf-8');
          const firstLine = content.split('\n')[0];
          const header = JSON.parse(firstLine) as AsciicastHeader;
          const lines = content.trim().split('\n').length - 1; // exclude header
          const stat = statSync(filePath);

          recordings.push({
            id,
            sessionId: '',
            status: 'stopped',
            filePath,
            startedAt: header.timestamp * 1000,
            eventCount: lines,
            cols: header.width,
            rows: header.height,
            title: header.title,
            fileSize: stat.size,
          });
        } catch {}
      }
    } catch {}

    return recordings.sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Get a recording's events for playback.
   */
  getRecordingEvents(
    recordingId: string,
  ): { header: AsciicastHeader; events: AsciicastEvent[] } | null {
    const filePath = join(this.config.outputDir, `${recordingId}.cast`);
    if (!existsSync(filePath)) return null;

    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      const header = JSON.parse(lines[0]) as AsciicastHeader;
      const events: AsciicastEvent[] = [];

      for (let i = 1; i < lines.length; i++) {
        try {
          const [time, type, data] = JSON.parse(lines[i]);
          events.push({ time, type, data });
        } catch {}
      }

      return { header, events };
    } catch {
      return null;
    }
  }

  /**
   * Delete a recording.
   */
  deleteRecording(recordingId: string): boolean {
    const filePath = join(this.config.outputDir, `${recordingId}.cast`);
    if (!existsSync(filePath)) return false;
    try {
      unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Prune old recordings.
   */
  prune(): number {
    if (this.config.retentionDays <= 0) return 0;
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    let pruned = 0;
    const dir = this.config.outputDir;
    if (!existsSync(dir)) return 0;

    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.cast'));
      for (const file of files) {
        const filePath = join(dir, file);
        try {
          const stat = statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            unlinkSync(filePath);
            pruned++;
          }
        } catch {}
      }
    } catch {}

    return pruned;
  }
}

export const terminalRecording = TerminalRecordingService.getInstance();
