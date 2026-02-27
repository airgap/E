import { Hono } from 'hono';
import { getDb } from '../db/database';
import { calculateCost } from '../services/cost-calculator';

const app = new Hono();

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateISO(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDayBounds(dateStr: string): { startMs: number; endMs: number } {
  // Parse YYYY-MM-DD as local midnight
  const [year, month, day] = dateStr.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getGitCommits(dateStr: string, workspacePath?: string): Promise<string[]> {
  try {
    const cwd = workspacePath || process.cwd();
    const proc = Bun.spawn(
      [
        'git',
        'log',
        '--oneline',
        `--since=${dateStr}`,
        `--until=${dateStr} 23:59:59`,
        '--format=%h %s',
        '--',
        'HEAD',
      ],
      { cwd, stdout: 'pipe', stderr: 'pipe' },
    );
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildSummary(data: {
  date: string;
  conversations: Array<{
    id: string;
    title: string;
    model: string;
    tokens: number;
    costUsd: number;
  }>;
  gitCommits: string[];
  storiesCompleted: Array<{ title: string; status: string }>;
  loopsRun: number;
  totalCostUsd: number;
  totalTokens: number;
  totalConversations: number;
}): string {
  const dateLabel = formatDate(new Date(data.date + 'T00:00:00').getTime());
  const lines: string[] = [`## Daily Digest — ${dateLabel}`, ''];

  const costStr = `~$${data.totalCostUsd.toFixed(2)}`;
  const tokensStr = data.totalTokens.toLocaleString();
  lines.push(
    `**Conversations:** ${data.totalConversations} session${data.totalConversations !== 1 ? 's' : ''}, ${tokensStr} tokens (${costStr})`,
  );
  lines.push('');

  if (data.storiesCompleted.length > 0) {
    lines.push('**Work Completed:**');
    for (const s of data.storiesCompleted) {
      lines.push(`- ✅ ${s.title}`);
    }
    lines.push('');
  }

  if (data.gitCommits.length > 0) {
    lines.push(`**Git Commits (${data.gitCommits.length}):**`);
    for (const c of data.gitCommits) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  if (data.loopsRun > 0) {
    lines.push(`**Loops Run:** ${data.loopsRun}`);
    lines.push('');
  }

  lines.push('**Time Well Spent!**');

  return lines.join('\n');
}

async function buildDailyDigest(
  dateStr: string,
  workspacePath?: string,
): Promise<{
  date: string;
  conversations: Array<{
    id: string;
    title: string;
    model: string;
    tokens: number;
    costUsd: number;
  }>;
  gitCommits: string[];
  storiesCompleted: Array<{ title: string; status: string }>;
  loopsRun: number;
  totalCostUsd: number;
  totalTokens: number;
  totalConversations: number;
  summary: string;
}> {
  const db = getDb();
  const { startMs, endMs } = getDayBounds(dateStr);

  // Query conversations
  const convRows = db
    .query(
      `SELECT id, title, model, total_tokens, updated_at FROM conversations
       WHERE updated_at >= ? AND updated_at < ?
       AND (workspace_path = ? OR ? IS NULL)`,
    )
    .all(startMs, endMs, workspacePath ?? null, workspacePath ?? null) as Array<{
    id: string;
    title: string;
    model: string;
    total_tokens: number;
    updated_at: number;
  }>;

  const conversations = convRows.map((r) => ({
    id: r.id,
    title: r.title || '(untitled)',
    model: r.model || '',
    tokens: r.total_tokens || 0,
    costUsd: calculateCost(
      r.model || '',
      Math.floor((r.total_tokens || 0) * 0.7),
      Math.floor((r.total_tokens || 0) * 0.3),
    ),
  }));

  // Query stories completed
  let storiesCompleted: Array<{ title: string; status: string }> = [];
  try {
    const storyRows = db
      .query(
        `SELECT title, status FROM prd_stories
         WHERE updated_at >= ? AND updated_at < ? AND status = 'completed'
         AND (workspace_path = ? OR ? IS NULL)`,
      )
      .all(startMs, endMs, workspacePath ?? null, workspacePath ?? null) as Array<{
      title: string;
      status: string;
    }>;
    storiesCompleted = storyRows;
  } catch {
    // Table may not exist
  }

  // Query loops completed
  let loopsRun = 0;
  try {
    const loopRows = db
      .query(
        `SELECT id, status, total_stories_completed FROM loops
         WHERE completed_at >= ? AND completed_at < ?`,
      )
      .all(startMs, endMs) as Array<{
      id: string;
      status: string;
      total_stories_completed: number;
    }>;
    loopsRun = loopRows.length;
  } catch {
    // Table may not exist
  }

  // Get git commits
  const gitCommits = await getGitCommits(dateStr, workspacePath);

  // Compute totals
  const totalTokens = conversations.reduce((acc, c) => acc + c.tokens, 0);
  const totalCostUsd = conversations.reduce((acc, c) => acc + c.costUsd, 0);
  const totalConversations = conversations.length;

  const data = {
    date: dateStr,
    conversations,
    gitCommits,
    storiesCompleted,
    loopsRun,
    totalCostUsd,
    totalTokens,
    totalConversations,
    summary: '',
  };

  data.summary = buildSummary(data);

  return data;
}

// GET /digest/today
app.get('/today', async (c) => {
  const workspacePath = c.req.query('workspacePath') || undefined;
  const date = c.req.query('date') || todayISO();

  try {
    const data = await buildDailyDigest(date, workspacePath);
    return c.json({ ok: true, data });
  } catch (err: any) {
    return c.json({ ok: false, error: err?.message || 'Failed to build digest' }, 500);
  }
});

// GET /digest/week
app.get('/week', async (c) => {
  const workspacePath = c.req.query('workspacePath') || undefined;

  try {
    const results: any[] = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = formatDateISO(d.getTime());
      const dayData = await buildDailyDigest(dateStr, workspacePath);
      results.push(dayData);
    }
    return c.json({ ok: true, data: results });
  } catch (err: any) {
    return c.json({ ok: false, error: err?.message || 'Failed to build week digest' }, 500);
  }
});

export { app as digestRoutes };
