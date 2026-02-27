/**
 * Tool execution engine for Bedrock and Ollama providers.
 * Executes built-in tools and MCP tools, returning results in a standardized format.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync, spawnSync } from 'child_process';
import { isMcpTool, executeMcpTool } from './mcp-tool-adapter';

export interface ToolResult {
  content: string;
  is_error?: boolean;
}

/**
 * Execute a tool and return the result
 * Handles both built-in tools and MCP tools
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  workspacePath?: string,
): Promise<ToolResult> {
  try {
    // Check if this is an MCP tool
    if (isMcpTool(toolName)) {
      return await executeMcpTool(toolName, toolInput);
    }

    // Execute built-in tools
    switch (toolName) {
      case 'Read':
        return await executeReadTool(toolInput);
      case 'Write':
        return await executeWriteTool(toolInput);
      case 'Edit':
        return await executeEditTool(toolInput);
      case 'Glob':
        return await executeGlobTool(toolInput, workspacePath);
      case 'Grep':
        return await executeGrepTool(toolInput, workspacePath);
      case 'Bash':
        return await executeBashTool(toolInput, workspacePath);
      case 'WebFetch':
        return await executeWebFetchTool(toolInput);
      case 'WebSearch':
        return await executeWebSearchTool(toolInput);
      case 'NotebookEdit':
        return await executeNotebookEditTool(toolInput);
      case 'canvas_push':
        return await executeCanvasPushTool(toolInput);
      case 'canvas_snapshot':
        return await executeCanvasSnapshotTool(toolInput);
      case 'CaptureScreenshot':
        return await executeCaptureScreenshotTool(toolInput);
      case 'ListDisplays':
        return await executeListDisplaysTool();
      case 'GetLocation':
        return await executeGetLocationTool();
      case 'CaptureCamera':
        return await executeCaptureCameraTool(toolInput);
      case 'Skill':
        return await executeSkillTool(toolInput, workspacePath);
      case 'AskUserQuestion':
        // AskUserQuestion is handled by the streaming layer (SSE user_question_request event).
        // For non-CLI providers, return a pending marker so the provider loop can wait.
        return {
          content: JSON.stringify({
            __ask_user: true,
            questions: toolInput.questions || [],
          }),
        };
      default:
        return {
          content: `Unknown tool: ${toolName}`,
          is_error: true,
        };
    }
  } catch (error) {
    return {
      content: `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeReadTool(input: Record<string, unknown>): Promise<ToolResult> {
  const filePath = String(input.file_path);
  const offset = input.offset ? Number(input.offset) : undefined;
  const limit = input.limit ? Number(input.limit) : undefined;

  if (!existsSync(filePath)) {
    return {
      content: `File not found: ${filePath}`,
      is_error: true,
    };
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let result: string[];
  if (offset !== undefined || limit !== undefined) {
    const start = offset ? offset - 1 : 0;
    const end = limit ? start + limit : lines.length;
    result = lines.slice(start, end);
  } else {
    result = lines;
  }

  // Add line numbers like cat -n
  const numbered = result.map((line, idx) => {
    const lineNum = (offset || 1) + idx;
    return `${lineNum.toString().padStart(6, ' ')}  ${line}`;
  });

  return {
    content: numbered.join('\n'),
  };
}

async function executeWriteTool(input: Record<string, unknown>): Promise<ToolResult> {
  const filePath = String(input.file_path);
  const content = String(input.content);

  writeFileSync(filePath, content, 'utf-8');

  return {
    content: `Successfully wrote ${content.length} characters to ${filePath}`,
  };
}

async function executeEditTool(input: Record<string, unknown>): Promise<ToolResult> {
  const filePath = String(input.file_path);
  const oldString = String(input.old_string);
  const newString = String(input.new_string);
  const replaceAll = Boolean(input.replace_all);

  if (!existsSync(filePath)) {
    return {
      content: `File not found: ${filePath}`,
      is_error: true,
    };
  }

  const content = readFileSync(filePath, 'utf-8');

  if (!replaceAll) {
    // Check if old_string appears exactly once
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) {
      return {
        content: `String not found in file: ${oldString.substring(0, 100)}`,
        is_error: true,
      };
    }
    if (occurrences > 1) {
      return {
        content: `String appears ${occurrences} times. Use replace_all: true or provide a more specific old_string.`,
        is_error: true,
      };
    }
  }

  const newContent = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);

  writeFileSync(filePath, newContent, 'utf-8');

  const replacements = replaceAll ? content.split(oldString).length - 1 : 1;
  return {
    content: `Successfully replaced ${replacements} occurrence(s) in ${filePath}`,
  };
}

async function executeGlobTool(
  input: Record<string, unknown>,
  workspacePath?: string,
): Promise<ToolResult> {
  const pattern = String(input.pattern);
  const searchPath = input.path ? String(input.path) : workspacePath || process.cwd();

  try {
    // Use the Bun.Glob API for pattern matching
    const { Glob } = await import('bun');
    const glob = new Glob(pattern);
    const matches: string[] = [];

    for await (const file of glob.scan({ cwd: searchPath, absolute: true })) {
      matches.push(file);
    }

    if (matches.length === 0) {
      return {
        content: `No files found matching pattern: ${pattern}`,
      };
    }

    return {
      content: matches.join('\n'),
    };
  } catch (error) {
    return {
      content: `Error globbing: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeGrepTool(
  input: Record<string, unknown>,
  workspacePath?: string,
): Promise<ToolResult> {
  const pattern = String(input.pattern);
  const searchPath = input.path ? String(input.path) : workspacePath || '.';
  const outputMode = (input.output_mode as string) || 'files_with_matches';
  const globPattern = input.glob ? String(input.glob) : undefined;
  const caseInsensitive = Boolean(input.case_insensitive);
  const context = input.context ? Number(input.context) : undefined;

  try {
    // Build rg command as array — avoids shell metacharacter injection
    const args: string[] = [];

    if (caseInsensitive) args.push('-i');
    if (globPattern) args.push('--glob', globPattern);

    if (outputMode === 'files_with_matches') {
      args.push('-l');
    } else if (outputMode === 'count') {
      args.push('-c');
    } else if (outputMode === 'content') {
      args.push('-n');
      if (context) args.push('-C', String(context));
    }

    // Pattern and path as separate args — no shell interpolation
    args.push('--', pattern, searchPath);

    const result = spawnSync('rg', args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    if (result.status === 0) {
      return {
        content: result.stdout || 'No matches found',
      };
    }

    // rg returns exit code 1 when no matches found
    if (result.status === 1) {
      return {
        content: 'No matches found',
      };
    }

    return {
      content: `Error searching: ${result.stderr || 'rg failed'}`,
      is_error: true,
    };
  } catch (error: any) {
    return {
      content: `Error searching: ${error.message}`,
      is_error: true,
    };
  }
}

async function executeBashTool(
  input: Record<string, unknown>,
  workspacePath?: string,
): Promise<ToolResult> {
  const command = String(input.command);
  const timeout = input.timeout ? Number(input.timeout) : 120000;

  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      timeout,
      cwd: workspacePath || process.cwd(),
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    return {
      content: result || '(command completed with no output)',
    };
  } catch (error: any) {
    return {
      content: `Command failed with exit code ${error.status || 'unknown'}:\n${error.stderr || error.message}`,
      is_error: true,
    };
  }
}

async function executeWebFetchTool(input: Record<string, unknown>): Promise<ToolResult> {
  const url = String(input.url);
  const prompt = String(input.prompt);

  try {
    // This would integrate with the existing WebFetch tool implementation
    // For now, return a placeholder
    return {
      content: `WebFetch tool execution not yet fully integrated. URL: ${url}, Prompt: ${prompt}`,
    };
  } catch (error) {
    return {
      content: `Error fetching URL: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeWebSearchTool(input: Record<string, unknown>): Promise<ToolResult> {
  const query = String(input.query);

  try {
    // This would integrate with the existing WebSearch tool implementation
    // For now, return a placeholder
    return {
      content: `WebSearch tool execution not yet fully integrated. Query: ${query}`,
    };
  } catch (error) {
    return {
      content: `Error searching: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeNotebookEditTool(input: Record<string, unknown>): Promise<ToolResult> {
  const notebookPath = String(input.notebook_path);
  const newSource = String(input.new_source);
  const editMode = (input.edit_mode as string) || 'replace';

  try {
    if (!existsSync(notebookPath)) {
      return {
        content: `Notebook not found: ${notebookPath}`,
        is_error: true,
      };
    }

    const notebook = JSON.parse(readFileSync(notebookPath, 'utf-8'));

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return {
        content: 'Invalid notebook format: missing cells array',
        is_error: true,
      };
    }

    // For simplicity, edit the first code cell
    // In a full implementation, would use cell_id to find specific cell
    const cellIndex = notebook.cells.findIndex((c: any) => c.cell_type === 'code');

    if (cellIndex === -1) {
      return {
        content: 'No code cells found in notebook',
        is_error: true,
      };
    }

    if (editMode === 'replace') {
      notebook.cells[cellIndex].source = newSource.split('\n');
    } else if (editMode === 'insert') {
      notebook.cells.splice(cellIndex, 0, {
        cell_type: 'code',
        source: newSource.split('\n'),
        metadata: {},
        outputs: [],
        execution_count: null,
      });
    } else if (editMode === 'delete') {
      notebook.cells.splice(cellIndex, 1);
    }

    writeFileSync(notebookPath, JSON.stringify(notebook, null, 2), 'utf-8');

    return {
      content: `Successfully ${editMode}d cell in ${notebookPath}`,
    };
  } catch (error) {
    return {
      content: `Error editing notebook: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

/**
 * Canvas persistence — backed by SQLite canvases table.
 */
import { getDb } from '../db/database';

interface CanvasRow {
  id: string;
  conversation_id: string | null;
  content_type: string;
  content: string;
  title: string | null;
  created_at: number;
  updated_at: number;
}

function canvasFromRow(row: CanvasRow) {
  return {
    id: row.id,
    contentType: row.content_type as 'html' | 'svg' | 'mermaid' | 'table',
    content: row.content,
    title: row.title || undefined,
    conversationId: row.conversation_id || undefined,
    lastUpdated: row.updated_at,
  };
}

async function executeCanvasPushTool(
  input: Record<string, unknown>,
  workspacePath?: string,
): Promise<ToolResult> {
  const contentType = String(input.content_type) as 'html' | 'svg' | 'mermaid' | 'table';
  const content = String(input.content);
  const title = input.title ? String(input.title) : undefined;
  const canvasId = input.canvas_id ? String(input.canvas_id) : undefined;

  try {
    // Validate content type
    if (!['html', 'svg', 'mermaid', 'table'].includes(contentType)) {
      return {
        content: `Invalid content_type: ${contentType}. Must be one of: html, svg, mermaid, table`,
        is_error: true,
      };
    }

    // For tables, validate JSON
    if (contentType === 'table') {
      try {
        JSON.parse(content);
      } catch {
        return {
          content: 'Invalid table content: must be valid JSON array',
          is_error: true,
        };
      }
    }

    // Generate or use provided canvas ID
    const { nanoid } = await import('nanoid');
    const id = canvasId || nanoid(12);
    const now = Date.now();

    // Upsert into database
    const db = getDb();
    const existing = db.query('SELECT id FROM canvases WHERE id = ?').get(id) as any;
    if (existing) {
      db.query(
        'UPDATE canvases SET content_type = ?, content = ?, title = ?, updated_at = ? WHERE id = ?',
      ).run(contentType, content, title || null, now, id);
    } else {
      db.query(
        'INSERT INTO canvases (id, conversation_id, content_type, content, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, null, contentType, content, title || null, now, now);
    }

    // Return success with canvas ID and metadata for event emission
    // The streaming layer will pick up __canvas_update metadata and emit SSE event
    return {
      content: JSON.stringify({
        canvasId: id,
        contentType,
        title: title || 'Canvas',
        message: canvasId
          ? `Canvas ${id} updated successfully`
          : `Canvas ${id} created successfully`,
        __canvas_update: {
          canvasId: id,
          contentType,
          content,
          title,
        },
      }),
    };
  } catch (error) {
    return {
      content: `Error pushing to canvas: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeCanvasSnapshotTool(input: Record<string, unknown>): Promise<ToolResult> {
  const canvasId = String(input.canvas_id);

  try {
    const db = getDb();
    const row = db.query('SELECT * FROM canvases WHERE id = ?').get(canvasId) as CanvasRow | null;

    if (!row) {
      return {
        content: `Canvas not found: ${canvasId}`,
        is_error: true,
      };
    }

    const canvas = canvasFromRow(row);
    return {
      content: JSON.stringify({
        canvasId: canvas.id,
        contentType: canvas.contentType,
        content: canvas.content,
        title: canvas.title,
        lastUpdated: canvas.lastUpdated,
      }),
    };
  } catch (error) {
    return {
      content: `Error taking canvas snapshot: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

/**
 * Get canvas by ID (used by streaming layer to emit canvas updates)
 */
export function getCanvas(canvasId: string) {
  const db = getDb();
  const row = db.query('SELECT * FROM canvases WHERE id = ?').get(canvasId) as CanvasRow | null;
  return row ? canvasFromRow(row) : undefined;
}

/**
 * Get all canvases for a conversation
 */
export function getConversationCanvases(conversationId: string) {
  const db = getDb();
  const rows = db
    .query('SELECT * FROM canvases WHERE conversation_id = ? ORDER BY updated_at DESC')
    .all(conversationId) as CanvasRow[];
  return rows.map(canvasFromRow);
}

/**
 * Set conversation ID for a canvas
 */
export function setCanvasConversation(canvasId: string, conversationId: string) {
  const db = getDb();
  db.query('UPDATE canvases SET conversation_id = ? WHERE id = ?').run(conversationId, canvasId);
}

/**
 * Device capability tools
 * These tools coordinate with Tauri for actual capture, but the server validates permissions
 */

async function executeCaptureScreenshotTool(input: Record<string, unknown>): Promise<ToolResult> {
  try {
    // Check if screenshot capability is enabled
    const db = getDb();
    const settingsRow = db.query('SELECT value FROM settings WHERE key = ?').get('settings') as any;

    if (!settingsRow) {
      return {
        content: 'Settings not found. Please configure device capabilities in Settings.',
        is_error: true,
      };
    }

    const settings = JSON.parse(settingsRow.value);
    const capabilities = settings.deviceCapabilities || {};

    if (!capabilities.screenshotEnabled) {
      return {
        content:
          'Screenshot capture is disabled. Enable it in Settings > Device Capabilities to allow agents to capture screenshots.',
        is_error: true,
      };
    }

    // Tool input
    const displayIndex = input.display_index ? Number(input.display_index) : 0;
    const saveToWorkspace = input.save_to_workspace !== false;

    // Return instructions for the client/Tauri layer to execute
    // The actual screenshot will be taken by the frontend and returned as an attachment
    return {
      content: JSON.stringify({
        __device_action: 'screenshot',
        display_index: displayIndex,
        save_to_workspace: saveToWorkspace,
        message: `Requesting screenshot capture from display ${displayIndex}. The screenshot will be automatically included in the conversation.`,
      }),
    };
  } catch (error) {
    return {
      content: `Error requesting screenshot: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeListDisplaysTool(): Promise<ToolResult> {
  try {
    // Check if screenshot capability is enabled
    const db = getDb();
    const settingsRow = db.query('SELECT value FROM settings WHERE key = ?').get('settings') as any;

    if (!settingsRow) {
      return {
        content: 'Settings not found. Please configure device capabilities in Settings.',
        is_error: true,
      };
    }

    const settings = JSON.parse(settingsRow.value);
    const capabilities = settings.deviceCapabilities || {};

    if (!capabilities.screenshotEnabled) {
      return {
        content:
          'Screenshot capture is disabled. Enable it in Settings > Device Capabilities to list displays.',
        is_error: true,
      };
    }

    // Return instructions for the client/Tauri layer to execute
    return {
      content: JSON.stringify({
        __device_action: 'list_displays',
        message: 'Requesting display list from the system.',
      }),
    };
  } catch (error) {
    return {
      content: `Error listing displays: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeGetLocationTool(): Promise<ToolResult> {
  try {
    // Check if location capability is enabled
    const db = getDb();
    const settingsRow = db.query('SELECT value FROM settings WHERE key = ?').get('settings') as any;

    if (!settingsRow) {
      return {
        content: 'Settings not found. Please configure device capabilities in Settings.',
        is_error: true,
      };
    }

    const settings = JSON.parse(settingsRow.value);
    const capabilities = settings.deviceCapabilities || {};

    if (!capabilities.locationEnabled) {
      return {
        content:
          'Location access is disabled. Enable it in Settings > Device Capabilities to allow location-aware features.',
        is_error: true,
      };
    }

    // Return instructions for the client/Tauri layer to execute
    return {
      content: JSON.stringify({
        __device_action: 'get_location',
        message:
          'Requesting location information. This uses IP-based geolocation (privacy-friendly, no GPS).',
      }),
    };
  } catch (error) {
    return {
      content: `Error requesting location: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeCaptureCameraTool(input: Record<string, unknown>): Promise<ToolResult> {
  try {
    // Check if camera capability is enabled
    const db = getDb();
    const settingsRow = db.query('SELECT value FROM settings WHERE key = ?').get('settings') as any;

    if (!settingsRow) {
      return {
        content: 'Settings not found. Please configure device capabilities in Settings.',
        is_error: true,
      };
    }

    const settings = JSON.parse(settingsRow.value);
    const capabilities = settings.deviceCapabilities || {};

    if (!capabilities.cameraEnabled) {
      return {
        content:
          'Camera access is disabled. Enable it in Settings > Device Capabilities to allow camera capture.',
        is_error: true,
      };
    }

    // Tool input
    const saveToWorkspace = input.save_to_workspace !== false;

    // Return instructions for the client/Tauri layer to execute
    return {
      content: JSON.stringify({
        __device_action: 'capture_camera',
        save_to_workspace: saveToWorkspace,
        message:
          'Requesting camera capture. The photo will be automatically included in the conversation. Note: Camera access requires OS permissions (TCC on macOS).',
      }),
    };
  } catch (error) {
    return {
      content: `Error requesting camera capture: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

/**
 * Execute the Skill tool for pattern detection and skill management
 */
async function executeSkillTool(
  input: Record<string, unknown>,
  workspacePath?: string,
): Promise<ToolResult> {
  try {
    const action = String(input.action);

    if (action === 'search') {
      // Search skills registry for existing skills
      const query = String(input.query || '');

      if (!query) {
        return {
          content: 'Please provide a search query to find relevant skills.',
          is_error: true,
        };
      }

      // Call the skills registry API endpoint
      const response = await fetch(
        `http://localhost:${process.env.PORT || 3030}/api/skills-registry/suggest?query=${encodeURIComponent(query)}`,
      );
      const data = await response.json();

      if (!data.ok) {
        return {
          content: `Error searching skills registry: ${data.error}`,
          is_error: true,
        };
      }

      const suggestions = data.data || [];

      if (suggestions.length === 0) {
        return {
          content: `No skills found matching "${query}". Consider proposing a new skill if you detect a recurring pattern.`,
        };
      }

      const resultText = `Found ${suggestions.length} skill(s) matching "${query}":\n\n${suggestions
        .map(
          (s: any, i: number) =>
            `${i + 1}. **${s.skillName}** (ID: \`${s.skillId}\`)\n   ${s.reason}\n   Confidence: ${Math.round(s.confidence * 100)}%`,
        )
        .join('\n\n')}`;

      return { content: resultText };
    } else if (action === 'propose') {
      // Propose a new skill or rule
      const proposal = input.proposal as any;

      if (!proposal) {
        return {
          content:
            'Please provide proposal details (type, name, description, content, category, tags, examples).',
          is_error: true,
        };
      }

      if (!workspacePath) {
        return {
          content: 'Workspace path is required to create a proposal.',
          is_error: true,
        };
      }

      const { type, name, description, content, category, tags, examples } = proposal;

      if (!type || !name || !description || !content) {
        return {
          content:
            'Proposal must include: type ("skill" or "rule"), name, description, and content.',
          is_error: true,
        };
      }

      // Create an agent note with the proposal
      const notePayload = {
        workspacePath,
        title: `${type === 'skill' ? '🎯 Skill' : '📋 Rule'} Proposal: ${name}`,
        content: `## Proposed ${type === 'skill' ? 'Skill' : 'Rule'}: ${name}

${description}

### Content

\`\`\`markdown
${content}
\`\`\`

### Details
- **Category**: ${category || 'workflow'}
- **Tags**: ${tags ? tags.join(', ') : 'auto-generated'}

### Examples
${examples ? examples.map((ex: string, i: number) => `${i + 1}. ${ex}`).join('\n') : 'No examples provided'}

---

**To approve this proposal**, use the Agent Notes panel to mark this as read and approved. The ${type} will be automatically created in your workspace.`,
        category: 'skill-proposal',
        metadata: {
          proposalType: type,
          suggestedName: name,
          suggestedCategory: category || 'workflow',
          suggestedTags: tags || [],
          generatedContent: content,
        },
      };

      const noteResponse = await fetch(
        `http://localhost:${process.env.PORT || 3030}/api/agent-notes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notePayload),
        },
      );

      const noteData = await noteResponse.json();

      if (!noteData.ok) {
        return {
          content: `Error creating proposal note: ${noteData.error}`,
          is_error: true,
        };
      }

      return {
        content: `✅ **${type === 'skill' ? 'Skill' : 'Rule'} proposal created**: "${name}"

I've detected a recurring pattern and created a proposal to automate it.

The proposal has been saved as an agent note for your review. You can find it in the **Agent Notes** panel (look for the 🎯 or 📋 icon in the sidebar).

**What happens next:**
1. Review the proposal in the Agent Notes panel
2. If you approve it, the ${type} will be automatically created in your workspace
3. Once created, this pattern will be available for reuse in future work

This is part of my self-learning system — I'm tracking patterns in your workflow to suggest helpful automations!`,
      };
    } else if (action === 'check-learning') {
      // View the learning log
      const filter = input.query ? String(input.query) : undefined;

      if (!workspacePath) {
        return {
          content: 'Workspace path is required to check the learning log.',
          is_error: true,
        };
      }

      const response = await fetch(
        `http://localhost:${process.env.PORT || 3030}/api/learning/log?workspacePath=${encodeURIComponent(workspacePath)}`,
      );
      const data = await response.json();

      if (!data.ok) {
        return {
          content: `Error retrieving learning log: ${data.error}`,
          is_error: true,
        };
      }

      const entries = data.data || [];

      if (entries.length === 0) {
        return {
          content:
            'No learning log entries found yet. The system will automatically track patterns as you work.',
        };
      }

      let filteredEntries = entries;
      if (filter) {
        filteredEntries = entries.filter((e: any) =>
          e.message.toLowerCase().includes(filter.toLowerCase()),
        );
      }

      const resultText = `**Learning Log** (${filteredEntries.length} ${filter ? 'matching ' : ''}entries):\n\n${filteredEntries
        .slice(0, 10)
        .map(
          (e: any, i: number) =>
            `${i + 1}. [${e.event_type}] ${e.message}\n   ${new Date(e.timestamp).toLocaleString()}`,
        )
        .join(
          '\n\n',
        )}${filteredEntries.length > 10 ? `\n\n_... and ${filteredEntries.length - 10} more entries_` : ''}`;

      return { content: resultText };
    } else {
      return {
        content: `Unknown action: ${action}. Valid actions are: "search", "propose", "check-learning".`,
        is_error: true,
      };
    }
  } catch (error) {
    return {
      content: `Error executing Skill tool: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}
