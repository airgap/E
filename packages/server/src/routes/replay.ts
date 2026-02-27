import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';

export const replayRoutes = new Hono();

interface ReplayEvent {
  id: string;
  type: 'narration' | 'thinking' | 'tool_call' | 'tool_result' | 'user_message';
  role: 'user' | 'assistant';
  text: string;
  toolName?: string;
  timestamp: number;
  delay: number;
}

function extractEventsFromMessage(message: {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  const role = message.role as 'user' | 'assistant';

  let blocks: any[];
  try {
    blocks = JSON.parse(message.content);
    if (!Array.isArray(blocks)) {
      // Plain string content (old format)
      blocks = [{ type: 'text', text: message.content }];
    }
  } catch {
    blocks = [{ type: 'text', text: message.content }];
  }

  if (role === 'user') {
    // For user messages, emit a single user_message event
    const textBlocks = blocks.filter((b: any) => b.type === 'text');
    const text = textBlocks
      .map((b: any) => b.text || '')
      .join(' ')
      .slice(0, 500);
    if (text.trim()) {
      events.push({
        id: nanoid(),
        type: 'user_message',
        role: 'user',
        text,
        timestamp: message.timestamp,
        delay: 0, // filled in later
      });
    }
    return events;
  }

  // Assistant message: walk content blocks
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;

    if (block.type === 'text' && block.text) {
      events.push({
        id: nanoid(),
        type: 'narration',
        role: 'assistant',
        text: String(block.text).slice(0, 500),
        timestamp: message.timestamp,
        delay: 0,
      });
    } else if (block.type === 'thinking' && block.thinking) {
      events.push({
        id: nanoid(),
        type: 'thinking',
        role: 'assistant',
        text: String(block.thinking).slice(0, 500),
        timestamp: message.timestamp,
        delay: 0,
      });
    } else if (block.type === 'tool_use') {
      const inputSummary = block.input ? JSON.stringify(block.input).slice(0, 200) : '(no input)';
      events.push({
        id: nanoid(),
        type: 'tool_call',
        role: 'assistant',
        text: `Tool: ${block.name || 'unknown'} — ${inputSummary}`,
        toolName: block.name || 'unknown',
        timestamp: message.timestamp,
        delay: 0,
      });
    } else if (block.type === 'tool_result') {
      const content = block.content;
      let resultText = '';
      if (typeof content === 'string') {
        resultText = content.slice(0, 200);
      } else if (Array.isArray(content)) {
        resultText = content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text || '')
          .join(' ')
          .slice(0, 200);
      }
      events.push({
        id: nanoid(),
        type: 'tool_result',
        role: 'assistant',
        text: resultText || '(empty result)',
        timestamp: message.timestamp,
        delay: 0,
      });
    }
  }

  return events;
}

// GET /replay/:conversationId
replayRoutes.get('/:conversationId', async (c) => {
  const { conversationId } = c.req.param();
  const db = getDb();

  // Get conversation title
  const conversation = db
    .query('SELECT id, title FROM conversations WHERE id = ?')
    .get(conversationId) as { id: string; title: string } | null;

  if (!conversation) {
    return c.json({ ok: false, error: 'Conversation not found' }, 404);
  }

  // Get all messages ordered by timestamp
  const messages = db
    .query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
    .all(conversationId) as Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
  }>;

  // Extract replay events from all messages
  const allEvents: ReplayEvent[] = [];
  for (const msg of messages) {
    const msgEvents = extractEventsFromMessage(msg);
    allEvents.push(...msgEvents);
  }

  // Assign cumulative delays (200ms per event)
  const EVENT_DELAY_MS = 200;
  for (let i = 0; i < allEvents.length; i++) {
    allEvents[i].delay = i * EVENT_DELAY_MS;
  }

  const totalEvents = allEvents.length;
  const duration = totalEvents * EVENT_DELAY_MS;

  return c.json({
    ok: true,
    data: {
      conversationId,
      title: conversation.title,
      totalEvents,
      duration,
      events: allEvents,
    },
  });
});

// GET /replay/:conversationId/changes
replayRoutes.get('/:conversationId/changes', async (c) => {
  const { conversationId } = c.req.param();
  const db = getDb();

  // Get conversation to find workspacePath
  const conversation = db
    .query('SELECT id, workspace_path FROM conversations WHERE id = ?')
    .get(conversationId) as { id: string; workspace_path: string | null } | null;

  if (!conversation) {
    return c.json({ ok: false, error: 'Conversation not found' }, 404);
  }

  const filesChanged: Array<{ path: string; operation: 'created' | 'modified' | 'deleted' }> = [];
  const commits: string[] = [];
  const filePathsSeen = new Set<string>();

  // Try to find git commits that reference this conversationId
  if (conversation.workspace_path) {
    try {
      const proc = Bun.spawn(
        ['git', 'log', '--all', '--oneline', '--name-status', `--format=%H %s`],
        {
          cwd: conversation.workspace_path,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      if (stdout.trim()) {
        const lines = stdout.trim().split('\n');
        let currentCommitReferenced = false;
        let currentCommitHash = '';

        for (const line of lines) {
          if (!line.trim()) {
            currentCommitReferenced = false;
            currentCommitHash = '';
            continue;
          }

          // Detect commit header lines (hash + subject)
          const commitMatch = line.match(/^([0-9a-f]{40}|[0-9a-f]{7,10})\s+(.*)$/);
          if (commitMatch) {
            currentCommitHash = commitMatch[1];
            const subject = commitMatch[2];
            currentCommitReferenced = subject.includes(conversationId);
            if (currentCommitReferenced) {
              commits.push(`${currentCommitHash} ${subject}`);
            }
            continue;
          }

          // Detect file status lines (A/M/D\tpath)
          if (currentCommitReferenced) {
            const fileMatch = line.match(/^([AMD])\t(.+)$/);
            if (fileMatch) {
              const statusChar = fileMatch[1];
              const filePath = fileMatch[2];
              if (!filePathsSeen.has(filePath)) {
                filePathsSeen.add(filePath);
                const operation =
                  statusChar === 'A' ? 'created' : statusChar === 'D' ? 'deleted' : 'modified';
                filesChanged.push({ path: filePath, operation });
              }
            }
          }
        }
      }
    } catch {
      // git not available or not a repo, skip
    }
  }

  // Also scan messages for file-writing tool calls
  const messages = db
    .query('SELECT content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
    .all(conversationId) as Array<{ content: string }>;

  const FILE_WRITE_TOOLS = new Set([
    'write_file',
    'edit_file',
    'create_file',
    'Write',
    'Edit',
    'str_replace_editor',
  ]);

  for (const msg of messages) {
    let blocks: any[];
    try {
      blocks = JSON.parse(msg.content);
      if (!Array.isArray(blocks)) continue;
    } catch {
      continue;
    }

    for (const block of blocks) {
      if (block && block.type === 'tool_use' && FILE_WRITE_TOOLS.has(block.name) && block.input) {
        const input = block.input;
        const filePath = input.path || input.file_path || input.filename || input.filePath || null;
        if (filePath && typeof filePath === 'string' && !filePathsSeen.has(filePath)) {
          filePathsSeen.add(filePath);
          // Determine operation based on tool name
          const operation: 'created' | 'modified' =
            block.name === 'create_file' ? 'created' : 'modified';
          filesChanged.push({ path: filePath, operation });
        }
      }
    }
  }

  return c.json({
    ok: true,
    data: {
      filesChanged,
      commits,
    },
  });
});
