/**
 * Terminal Session Recording & Replay
 *
 * Record terminal sessions in asciicast v2 format for
 * later playback and review.
 */

export type RecordingStatus = 'recording' | 'stopped' | 'error';

export interface TerminalRecording {
  id: string;
  /** Associated terminal session ID */
  sessionId: string;
  /** Recording status */
  status: RecordingStatus;
  /** File path where recording is saved */
  filePath: string;
  /** Recording start time */
  startedAt: number;
  /** Recording end time */
  stoppedAt?: number;
  /** Duration in seconds */
  durationSeconds?: number;
  /** Total number of events recorded */
  eventCount: number;
  /** Terminal dimensions at start */
  cols: number;
  rows: number;
  /** File size in bytes */
  fileSize?: number;
  /** Optional title/label */
  title?: string;
}

export interface AsciicastHeader {
  version: 2;
  width: number;
  height: number;
  timestamp: number;
  title?: string;
  env?: Record<string, string>;
}

export interface AsciicastEvent {
  /** Time offset from start (seconds) */
  time: number;
  /** Event type: 'o' for output, 'i' for input */
  type: 'o' | 'i';
  /** Event data (terminal output/input text) */
  data: string;
}

export interface RecordingConfig {
  /** Directory to store recordings */
  outputDir: string;
  /** Maximum recording duration (seconds, 0 = unlimited) */
  maxDurationSeconds: number;
  /** Maximum file size (bytes, 0 = unlimited) */
  maxFileSizeBytes: number;
  /** Auto-record all sessions */
  autoRecord: boolean;
  /** Compress recordings with gzip */
  compress: boolean;
  /** Days to keep recordings (0 = forever) */
  retentionDays: number;
}

export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  outputDir: '.e/recordings',
  maxDurationSeconds: 3600,
  maxFileSizeBytes: 50_000_000,
  autoRecord: false,
  compress: false,
  retentionDays: 30,
};
