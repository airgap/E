import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { conversationRoutes } from './routes/conversations';
import { streamRoutes } from './routes/stream';
import { toolRoutes } from './routes/tools';
import { taskRoutes } from './routes/tasks';
import { settingsRoutes } from './routes/settings';
import { mcpRoutes } from './routes/mcp';
import { memoryRoutes } from './routes/memory';
import { agentRoutes } from './routes/agents';
import { fileRoutes } from './routes/files';
import { fileWatchRoutes } from './routes/file-watch';
import { commandRoutes } from './routes/commands';
import { workspaceRoutes } from './routes/projects';
import { searchRoutes } from './routes/search';
import { gitRoutes } from './routes/git/index';
import { terminalRoutes } from './routes/terminal';
import { lspRoutes } from './routes/lsp';
import { dapRoutes } from './routes/dap';
import { authRoutes } from './routes/auth';
import { workspaceMemoryRoutes } from './routes/project-memory';
import { prdRoutes } from './routes/prd/index';
import { loopRoutes } from './routes/loop';
import { externalRoutes } from './routes/external';
import compactionRoutes from './routes/compaction';
import { scanRoutes } from './routes/scan';
import { ambientRoutes } from './routes/ambient';
import { costRoutes } from './routes/costs';
import { digestRoutes } from './routes/digest';
import { diffRoutes } from './routes/diff';
import { replayRoutes } from './routes/replay';
import { customToolRoutes } from './routes/custom-tools';
import { pairRoutes } from './routes/pair';
import { initiativeRoutes } from './routes/initiatives';
import { skillsRegistryRoutes } from './routes/skills-registry';
import { rulesRoutes } from './routes/rules';
import { profileRoutes } from './routes/profiles';
import { artifactRoutes } from './routes/artifacts';
import { agentNoteRoutes } from './routes/agent-notes';
import { managerRoutes } from './routes/manager';
import { taskRunnerRoutes } from './routes/task-runner';
import { commentaryRoutes } from './routes/commentary';
import scheduledTasksRoutes from './routes/scheduled-tasks';
import webhookRoutes, { webhookInboundApp } from './routes/webhooks';
import { crossSessionRoutes } from './routes/cross-session';
import { aiActionRoutes } from './routes/ai-actions';
import { formatRoutes } from './routes/format';
import { mergeResolveRoutes } from './routes/merge-resolve';
import { gitSuggestRoutes } from './routes/git-suggest';
import { proactiveReviewRoutes } from './routes/proactive-review';
import { testAnalyzeRoutes } from './routes/test-analyze';
import { testGenerateRoutes } from './routes/test-generate';
import { remoteAccessRoutes } from './routes/remote-access';
import { sessionInfoRoutes } from './routes/session-info';
import { canvasRoutes } from './routes/canvas';
import { notificationChannelsRoutes } from './routes/notification-channels';
import { deviceRoutes } from './routes/device';
import { patternDetectionRoutes } from './routes/pattern-detection';
import { worktreeRoutes } from './routes/worktrees';
import { storyCoordinationRoutes } from './routes/story-coordination';
import { cloudBudgetRoutes } from './routes/cloud-budget';
import * as worktreeLifecycle from './services/worktree-lifecycle';
import { internalRoutes } from './routes/internal';
import { messageSyncRoutes } from './routes/message-sync';
import { golemRoutes } from './routes/golem';
import { kairosRoutes } from './routes/kairos';
import { autoDreamRoutes } from './routes/auto-dream';
import { swarmRoutes } from './routes/swarm';
import { buddyRoutes } from './routes/buddy';
import { featureFlagRoutes } from './routes/feature-flags';
import { ultraPlanRoutes } from './routes/ultraplan';
import { undercoverRoutes } from './routes/undercover';
import { browserRoutes } from './routes/browser';
import { promptCacheRoutes } from './routes/prompt-cache';
import { telemetryRoutes } from './routes/telemetry';
import { agentSleepRoutes } from './routes/agent-sleep';
import { swarmMailboxRoutes } from './routes/swarm-mailbox';
import { astRoutes } from './routes/ast';
import { memoryIndexRoutes } from './routes/memory-index';
import { modelRouterRoutes } from './routes/model-router';
import { providerFallbackRoutes } from './routes/provider-fallback';
import { contextSelectionRoutes } from './routes/context-selection';
import { retryRoutes } from './routes/retry';
import { impactAnalysisRoutes } from './routes/impact-analysis';
import { taskQueueRoutes } from './routes/task-queue';
import { codebaseInitRoutes } from './routes/codebase-init';
import { terminalRecordingRoutes } from './routes/terminal-recording';
import { authMiddleware } from './middleware/auth';
import { csrfMiddleware, isOriginAllowed } from './middleware/csrf';
import { websocket } from './ws';
import { initDatabase, getDb, ensureLocalGolem } from './db/database';
import { getHostname } from './golem-names';
import { taskScheduler } from './services/task-scheduler';
import { crossSessionService } from './services/cross-session';
import { claudeManager } from './services/claude-process';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Allowed TLS origins — set E_ALLOWED_ORIGINS env var to a comma-separated list
 * of origins that should be allowed when TLS is enabled (e.g. Tailscale hostnames).
 * Example: E_ALLOWED_ORIGINS=https://my-machine.tail1234.ts.net
 */
const allowedTlsOrigins = new Set(
  (process.env.E_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const app = new Hono();

// TLS configuration — set TLS_CERT and TLS_KEY env vars to enable HTTPS
const tlsCert = process.env.TLS_CERT;
const tlsKey = process.env.TLS_KEY;
const tls = tlsCert && tlsKey ? { cert: Bun.file(tlsCert), key: Bun.file(tlsKey) } : undefined;
const protocol = tls ? 'https' : 'http';

// Middleware
app.use(
  '*',
  cors({
    origin: (origin) => {
      // Deny requests with no Origin header — prevents cross-origin attacks
      // from iframes, forms, or fetches that omit the Origin.
      // Same-origin requests from the bundled client DO include Origin.
      if (!origin) return null;
      // Allow localhost, loopback, and private network IPs (LAN access from mobile)
      if (isOriginAllowed(origin)) return origin;
      // When TLS is enabled, only allow explicitly configured origins
      if (tls && allowedTlsOrigins.has(origin)) return origin;
      return null;
    },
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);
app.use('*', logger());

// Auth middleware (no-op in single-user mode)
app.use('/api/*', authMiddleware);

// CSRF protection — validates token + origin on all mutations
app.use('/api/*', csrfMiddleware);

// Health check
app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));

// API routes
app.route('/api/conversations', conversationRoutes);
app.route('/api/stream', streamRoutes);
app.route('/api/tools', toolRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/mcp', mcpRoutes);
app.route('/api/memory', memoryRoutes);
app.route('/api/agents', agentRoutes);
app.route('/api/files', fileRoutes);
app.route('/api/file-watch', fileWatchRoutes);
app.route('/api/commands', commandRoutes);
app.route('/api/workspaces', workspaceRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/git', gitRoutes);
app.route('/api/terminal', terminalRoutes);
app.route('/api/lsp', lspRoutes);
app.route('/api/dap', dapRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/workspace-memory', workspaceMemoryRoutes);
app.route('/api/prds', prdRoutes);
app.route('/api/loops', loopRoutes);
app.route('/api/external', externalRoutes);
app.route('/api/compaction', compactionRoutes);
app.route('/api/scan', scanRoutes);
app.route('/api/ambient', ambientRoutes);
app.route('/api/costs', costRoutes);
app.route('/api/digest', digestRoutes);
app.route('/api/diff', diffRoutes);
app.route('/api/replay', replayRoutes);
app.route('/api/custom-tools', customToolRoutes);
app.route('/api/pair', pairRoutes);
app.route('/api/initiatives', initiativeRoutes);
app.route('/api/skills-registry', skillsRegistryRoutes);
app.route('/api/rules', rulesRoutes);
app.route('/api/profiles', profileRoutes);
app.route('/api/artifacts', artifactRoutes);
app.route('/api/agent-notes', agentNoteRoutes);
app.route('/api/manager', managerRoutes);
app.route('/api/task-runner', taskRunnerRoutes);
app.route('/api/commentary', commentaryRoutes);
app.route('/api/scheduled-tasks', scheduledTasksRoutes);
app.route('/api/webhooks', webhookRoutes);
app.route('/api/cross-session', crossSessionRoutes);
app.route('/api/ai', aiActionRoutes);
app.route('/api/format', formatRoutes);
app.route('/api/git', mergeResolveRoutes);
app.route('/api/git', gitSuggestRoutes);
app.route('/api/review', proactiveReviewRoutes);
app.route('/api/tests', testAnalyzeRoutes);
app.route('/api/tests', testGenerateRoutes);
app.route('/api/remote-access', remoteAccessRoutes);
app.route('/api/session', sessionInfoRoutes);
app.route('/api/canvas', canvasRoutes);
app.route('/api/notification-channels', notificationChannelsRoutes);
app.route('/api/device', deviceRoutes);
app.route('/api/pattern-detection', patternDetectionRoutes);
app.route('/api/worktrees', worktreeRoutes);
app.route('/api/story-coordination', storyCoordinationRoutes);
app.route('/api/cloud-budget', cloudBudgetRoutes);
app.route('/api/message-sync', messageSyncRoutes);
app.route('/api/golem', golemRoutes);
app.route('/api/kairos', kairosRoutes);
app.route('/api/dream', autoDreamRoutes);
app.route('/api/swarm', swarmRoutes);
app.route('/api/buddy', buddyRoutes);
app.route('/api/feature-flags', featureFlagRoutes);
app.route('/api/ultraplan', ultraPlanRoutes);
app.route('/api/undercover', undercoverRoutes);
app.route('/api/browser', browserRoutes);
app.route('/api/prompt-cache', promptCacheRoutes);
app.route('/api/telemetry', telemetryRoutes);
app.route('/api/agent-sleep', agentSleepRoutes);
app.route('/api/swarm-mailbox', swarmMailboxRoutes);
app.route('/api/ast', astRoutes);
app.route('/api/memory-index', memoryIndexRoutes);
app.route('/api/model-router', modelRouterRoutes);
app.route('/api/provider-fallback', providerFallbackRoutes);
app.route('/api/context-selection', contextSelectionRoutes);
app.route('/api/retry', retryRoutes);
app.route('/api/impact-analysis', impactAnalysisRoutes);
app.route('/api/task-queue', taskQueueRoutes);
app.route('/api/codebase-init', codebaseInitRoutes);
app.route('/api/terminal-recording', terminalRecordingRoutes);

// Inbound webhook endpoint — bypasses auth/CSRF (uses its own token-based auth)
app.route('/api/webhooks/inbound', webhookInboundApp);

// Internal routes — used by MCP child processes (e.g. ask-user MCP server).
// Mounted outside /api/* to bypass auth/CSRF since these are localhost-only.
app.route('/internal', internalRoutes);

// Initialize database
initDatabase();

// Ensure local machine golem exists (creates one with a generated name on first boot)
ensureLocalGolem(getDb(), getHostname());

// Start worktree lifecycle manager (GC sweep + event-driven cleanup)
worktreeLifecycle.start();

// Register the built-in e-work MCP server for PRD/story/loop/canvas management.
// Uses upsert so we never duplicate — safe across restarts and HMR.
// Pass server port + CSRF token as env so the MCP server can call back to the REST API
// for features that live in-memory on the main server (e.g. canvas).
{
  const db = (await import('./db/database')).getDb();
  const { getCsrfToken: getToken } = await import('./middleware/csrf');
  const serverPath = resolve(import.meta.dir, 'mcp/e-work-server.ts');
  const mcpEnv = JSON.stringify({
    E_SERVER_PORT: process.env.PORT || '3002',
    E_CSRF_TOKEN: getToken(),
  });
  db.query(
    `INSERT INTO mcp_servers (name, transport, command, args, env, scope, status)
     VALUES ('e-work', 'stdio', 'bun', ?, ?, 'local', 'disconnected')
     ON CONFLICT(name) DO UPDATE SET command = 'bun', args = excluded.args, env = excluded.env`,
  ).run(JSON.stringify([serverPath]), mcpEnv);
}

// Clear stale CLI session IDs from any previous server instance —
// all in-memory CLI processes are gone after a restart.
claudeManager.clearStaleSessionIds();

// Ensure cross-session messaging table exists
crossSessionService.ensureTable();

// Ensure notification channels table exists
const { ensureNotificationChannelsTable } = await import('./services/notification-channels.js');
ensureNotificationChannelsTable();

// Initialize cloud budget notification listeners (budget warnings → notification channels)
const { initBudgetNotifications } = await import('./services/cloud-budget-notifier.js');
initBudgetNotifications();

// Ensure task scheduler is initialized (singleton auto-starts)
void taskScheduler;

// Start background task queue
{
  const { taskQueue } = await import('./services/task-queue');
  taskQueue.start();
}

// Initialize autoDream memory consolidation service
{
  const { autoDream } = await import('./services/auto-dream');
  const settingsRow = getDb()
    .query("SELECT value FROM settings WHERE key = 'workspacePath'")
    .get() as any;
  const wsPath = settingsRow ? JSON.parse(settingsRow.value) : '.';
  autoDream.init(wsPath);
  autoDream.markIdle(); // Start idle timer

  // Start filesystem watcher on the same workspace so the editor can react to external changes
  const { fileWatcher } = await import('./services/file-watcher');
  if (wsPath && wsPath !== '.') fileWatcher.watch(wsPath);
}

// Serve static client build when available (for `bun run start` single-process mode)
const clientBuildPath = process.env.CLIENT_DIST || resolve(import.meta.dir, '../../client/build');
if (existsSync(clientBuildPath)) {
  app.use('*', serveStatic({ root: clientBuildPath, rewriteRequestPath: (path) => path }));
  // SPA fallback — serve index.html for non-API, non-file routes
  app.get('*', async (c) => {
    // Never serve the SPA shell for API or health-check requests
    if (c.req.path.startsWith('/api/') || c.req.path === '/health') {
      return c.json({ ok: false, error: 'Not found' }, 404);
    }
    const file = Bun.file(resolve(clientBuildPath, 'index.html'));
    return c.html(await file.text());
  });
  console.log(`Serving client from ${clientBuildPath}`);
}

const requestedPort = process.env.PORT !== undefined ? Number(process.env.PORT) : 3002;

if (requestedPort === 0) {
  // Dynamic port mode (used by Tauri sidecar) — use Bun.serve directly
  const server = Bun.serve({
    port: 0,
    fetch: app.fetch,
    websocket,
    tls,
    idleTimeout: 120,
  });
  // Machine-parseable line for Tauri to read the actual port
  console.log(`E_PORT=${server.port}`);
  console.log(`E server running on ${protocol}://localhost:${server.port}`);
} else {
  console.log(`E_PORT=${requestedPort}`);
  console.log(`E server running on ${protocol}://localhost:${requestedPort}`);
}

// Used by Bun's module loader when requestedPort !== 0 (supports --hot reload in dev)
export default requestedPort !== 0
  ? { port: requestedPort, fetch: app.fetch, websocket, tls, idleTimeout: 120 }
  : undefined;
