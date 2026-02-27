// --- Task Runner Types ---

/** Supported package managers for script execution */
export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

/** Source of a discovered task */
export type TaskSource = 'package.json' | 'Makefile';

/** A workspace task discovered from package.json scripts or Makefile targets */
export interface WorkspaceTask {
  /** Unique identifier for the task (source:name) */
  id: string;
  /** Display name (e.g. "dev", "build", "test") */
  name: string;
  /** The source file where this task was found */
  source: TaskSource;
  /** The raw command/script content (e.g. "vite dev", "gcc -o main main.c") */
  command: string;
  /** The full execution command (e.g. "npm run dev", "make build") */
  execution: string;
}

/** Response from the task discovery endpoint */
export interface TaskDiscoveryResponse {
  /** Detected package manager, if any */
  packageManager: PackageManager | null;
  /** All discovered tasks */
  tasks: WorkspaceTask[];
}
