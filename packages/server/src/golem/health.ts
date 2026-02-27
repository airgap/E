// ---------------------------------------------------------------------------
// Golem Health Server — minimal HTTP server for /healthz liveness probes
// ---------------------------------------------------------------------------

import type { GolemRunStatus } from '@e/shared';

/**
 * Minimal HTTP server that exposes /healthz for orchestrator liveness probes.
 * Returns the current golem run status as JSON.
 */
export class GolemHealthServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private statusFn: () => GolemRunStatus;

  constructor(getStatus: () => GolemRunStatus) {
    this.statusFn = getStatus;
  }

  /**
   * Start the health check server on the given port.
   * Returns the actual port (useful if 0 was passed for dynamic allocation).
   */
  start(port: number): number {
    this.server = Bun.serve({
      port,
      fetch: (req) => {
        const url = new URL(req.url);

        if (url.pathname === '/healthz' || url.pathname === '/health') {
          const status = this.statusFn();
          const httpStatus = status.active ? 200 : 503;
          return new Response(JSON.stringify(status), {
            status: httpStatus,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.pathname === '/readyz') {
          // Readiness probe — only ready when actively executing
          const status = this.statusFn();
          const ready = status.active && status.phase !== 'initializing';
          return new Response(JSON.stringify({ ready, phase: status.phase }), {
            status: ready ? 200 : 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response('Not Found', { status: 404 });
      },
    });

    return this.server.port ?? port;
  }

  /**
   * Stop the health check server.
   */
  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }
}
