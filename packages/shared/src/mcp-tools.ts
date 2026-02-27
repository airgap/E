/**
 * MCP Tool Name Parsing Utility
 *
 * When Claude CLI calls MCP tools, names arrive in the format:
 *   mcp__<server-name>__<tool-name>
 *
 * e.g. "mcp__desktop-commander__read_file"
 *
 * This module parses that format and maps well-known MCP tools
 * to their built-in equivalents for rendering, approval, and
 * file-write detection.
 */

// ── Types ──

export interface ParsedToolName {
  /** The raw tool name as it arrived from the CLI */
  rawName: string;
  /** Whether this is an MCP-prefixed tool */
  isMcp: boolean;
  /** MCP server name (e.g. "desktop-commander"), null for built-in tools */
  serverName: string | null;
  /** The bare tool name after stripping the mcp__ prefix (e.g. "read_file") */
  toolName: string;
  /** Short display name for the UI (e.g. "Read" instead of "mcp__desktop-commander__read_file") */
  displayName: string;
  /** The built-in tool to render as, or null for unknown MCP tools */
  renderAs: string | null;
}

// ── Known MCP Tool Mappings ──

interface ToolMapping {
  renderAs: string;
  displayName: string;
}

/**
 * Map of well-known MCP tool bare names → built-in equivalents.
 * Keys are the tool name after stripping the mcp__server__ prefix.
 */
const KNOWN_MCP_TOOLS: Record<string, ToolMapping> = {
  // ── Desktop Commander ──
  read_file: { renderAs: 'Read', displayName: 'Read' },
  read_multiple_files: { renderAs: 'Read', displayName: 'Read' },
  write_file: { renderAs: 'Write', displayName: 'Write' },
  edit_block: { renderAs: 'Edit', displayName: 'Edit' },
  create_directory: { renderAs: 'Write', displayName: 'Mkdir' },
  move_file: { renderAs: 'Write', displayName: 'Move' },
  list_directory: { renderAs: 'Glob', displayName: 'List Dir' },
  get_file_info: { renderAs: 'Read', displayName: 'File Info' },
  start_process: { renderAs: 'Bash', displayName: 'Process' },
  interact_with_process: { renderAs: 'Bash', displayName: 'Process' },
  read_process_output: { renderAs: 'Bash', displayName: 'Process Output' },
  force_terminate: { renderAs: 'Bash', displayName: 'Terminate' },
  list_sessions: { renderAs: 'Bash', displayName: 'Sessions' },
  list_processes: { renderAs: 'Bash', displayName: 'Processes' },
  kill_process: { renderAs: 'Bash', displayName: 'Kill' },
  start_search: { renderAs: 'Grep', displayName: 'Search' },
  get_more_search_results: { renderAs: 'Grep', displayName: 'Search Results' },
  stop_search: { renderAs: 'Grep', displayName: 'Stop Search' },
  list_searches: { renderAs: 'Grep', displayName: 'Searches' },
  get_config: { renderAs: 'Read', displayName: 'Config' },
  set_config_value: { renderAs: 'Write', displayName: 'Set Config' },
  get_usage_stats: { renderAs: 'Read', displayName: 'Stats' },
  get_recent_tool_calls: { renderAs: 'Read', displayName: 'Tool History' },

  // ── @modelcontextprotocol/server-filesystem ──
  // These tools use simple names that may collide, but the mapping
  // still works since we only apply it to mcp__-prefixed names.

  // ── Puppeteer / Browser ──
  puppeteer_navigate: { renderAs: 'WebFetch', displayName: 'Navigate' },
  puppeteer_screenshot: { renderAs: 'WebFetch', displayName: 'Screenshot' },
  puppeteer_click: { renderAs: 'WebFetch', displayName: 'Click' },
  puppeteer_fill: { renderAs: 'WebFetch', displayName: 'Fill' },
  puppeteer_evaluate: { renderAs: 'Bash', displayName: 'Evaluate' },

  // ── GitHub ──
  create_or_update_file: { renderAs: 'Write', displayName: 'Update File' },
  search_repositories: { renderAs: 'Grep', displayName: 'Search Repos' },
  search_code: { renderAs: 'Grep', displayName: 'Search Code' },
  search_issues: { renderAs: 'Grep', displayName: 'Search Issues' },
  get_file_contents: { renderAs: 'Read', displayName: 'Get File' },
  list_commits: { renderAs: 'Read', displayName: 'Commits' },
  create_issue: { renderAs: 'Write', displayName: 'Create Issue' },
  create_pull_request: { renderAs: 'Write', displayName: 'Create PR' },

  // ── Brave Search ──
  brave_web_search: { renderAs: 'WebSearch', displayName: 'Web Search' },
  brave_local_search: { renderAs: 'WebSearch', displayName: 'Local Search' },

  // ── Memory ──
  create_entities: { renderAs: 'Write', displayName: 'Create Entities' },
  create_relations: { renderAs: 'Write', displayName: 'Create Relations' },
  search_nodes: { renderAs: 'Grep', displayName: 'Search Nodes' },
  open_nodes: { renderAs: 'Read', displayName: 'Open Nodes' },
  read_graph: { renderAs: 'Read', displayName: 'Read Graph' },
  delete_entities: { renderAs: 'Write', displayName: 'Delete Entities' },
  delete_relations: { renderAs: 'Write', displayName: 'Delete Relations' },

  // ── PostgreSQL ──
  query: { renderAs: 'Bash', displayName: 'Query' },

  // ── Cloudflare ──
  workers_list: { renderAs: 'Read', displayName: 'List Workers' },
  workers_get_worker: { renderAs: 'Read', displayName: 'Get Worker' },
  workers_get_worker_code: { renderAs: 'Read', displayName: 'Worker Code' },
  kv_namespaces_list: { renderAs: 'Read', displayName: 'List KV' },
  d1_databases_list: { renderAs: 'Read', displayName: 'List D1' },
  d1_database_query: { renderAs: 'Bash', displayName: 'D1 Query' },
  r2_buckets_list: { renderAs: 'Read', displayName: 'List R2' },
  search_cloudflare_documentation: { renderAs: 'WebSearch', displayName: 'CF Docs' },

  // ── E Work (PRD/Story/Loop Management) ──
  list_prds: { renderAs: 'Read', displayName: 'List PRDs' },
  get_prd: { renderAs: 'Read', displayName: 'Get PRD' },
  create_prd: { renderAs: 'Write', displayName: 'Create PRD' },
  update_prd: { renderAs: 'Write', displayName: 'Update PRD' },
  delete_prd: { renderAs: 'Write', displayName: 'Delete PRD' },
  list_stories: { renderAs: 'Read', displayName: 'List Stories' },
  create_story: { renderAs: 'Write', displayName: 'Create Story' },
  update_story: { renderAs: 'Write', displayName: 'Update Story' },
  delete_story: { renderAs: 'Write', displayName: 'Delete Story' },
  reorder_stories: { renderAs: 'Write', displayName: 'Reorder Stories' },
  archive_completed_stories: { renderAs: 'Write', displayName: 'Archive Stories' },
  batch_create_stories: { renderAs: 'Write', displayName: 'Batch Create Stories' },
  batch_update_stories: { renderAs: 'Write', displayName: 'Batch Update Stories' },
  list_loops: { renderAs: 'Read', displayName: 'List Loops' },
  get_loop: { renderAs: 'Read', displayName: 'Get Loop' },
};

/**
 * MCP tool bare names that are dangerous (require approval in safe mode).
 */
const DANGEROUS_MCP_TOOLS = new Set([
  // File system writes
  'write_file',
  'edit_block',
  'create_file',
  'move_file',
  'create_directory',
  'create_or_update_file',
  // Command execution
  'start_process',
  'execute_command',
  'interact_with_process',
  // Process control
  'force_terminate',
  'kill_process',
  // Browser automation (can execute scripts)
  'puppeteer_evaluate',
  // Database writes
  'create_entities',
  'create_relations',
  'delete_entities',
  'delete_relations',
  // E Work management (modify PRDs/stories/loops)
  'create_prd',
  'update_prd',
  'delete_prd',
  'create_story',
  'update_story',
  'delete_story',
  'reorder_stories',
  'archive_completed_stories',
  'batch_create_stories',
  'batch_update_stories',
]);

/**
 * MCP tool bare names that write to files (for editor refresh + verification).
 */
const FILE_WRITE_MCP_TOOLS = new Set([
  'write_file',
  'edit_block',
  'create_file',
  'move_file',
  'create_or_update_file',
]);

// ── Core Parser ──

/**
 * Parse a raw tool name (potentially MCP-prefixed) into structured components.
 *
 * Format: mcp__<server-name>__<tool-name>
 *
 * Examples:
 *   "Read" → { isMcp: false, toolName: "Read", displayName: "Read", renderAs: null }
 *   "mcp__desktop-commander__read_file" → { isMcp: true, serverName: "desktop-commander", toolName: "read_file", displayName: "Read", renderAs: "Read" }
 *   "mcp__my-server__custom_tool" → { isMcp: true, serverName: "my-server", toolName: "custom_tool", displayName: "custom_tool", renderAs: null }
 */
export function parseMcpToolName(rawName: string): ParsedToolName {
  // MCP tool names use double-underscore as separator.
  // Format: mcp__<server>__<tool>
  // Server names can contain hyphens but not double underscores.
  // Tool names can contain single underscores.
  if (!rawName.startsWith('mcp__')) {
    return {
      rawName,
      isMcp: false,
      serverName: null,
      toolName: rawName,
      displayName: rawName,
      renderAs: null,
    };
  }

  // Split on __ (double underscore)
  const parts = rawName.split('__');
  // parts[0] = "mcp", parts[1] = server name, parts[2..] = tool name parts
  if (parts.length < 3) {
    return {
      rawName,
      isMcp: false,
      serverName: null,
      toolName: rawName,
      displayName: rawName,
      renderAs: null,
    };
  }

  const serverName = parts[1];
  // Rejoin remaining parts — tool name may itself contain __ (rare but possible)
  const toolName = parts.slice(2).join('__');
  const known = KNOWN_MCP_TOOLS[toolName];

  return {
    rawName,
    isMcp: true,
    serverName,
    toolName,
    displayName: known?.displayName || toolName,
    renderAs: known?.renderAs || null,
  };
}

// ── Helpers ──

/** Check if an MCP tool is dangerous (should require approval in safe mode). */
export function isMcpToolDangerous(rawName: string): boolean {
  const parsed = parseMcpToolName(rawName);
  if (!parsed.isMcp) return false;
  return DANGEROUS_MCP_TOOLS.has(parsed.toolName);
}

/** Check if an MCP tool writes to files (for editor refresh + verification). */
export function isMcpFileWriteTool(rawName: string): boolean {
  const parsed = parseMcpToolName(rawName);
  if (!parsed.isMcp) return false;
  return FILE_WRITE_MCP_TOOLS.has(parsed.toolName);
}

/**
 * Extract file path from tool input regardless of parameter naming convention.
 * Different tools/MCP servers use different parameter names for file paths.
 */
export function extractFilePath(input: Record<string, unknown>): string | null {
  const candidates = ['file_path', 'path', 'filePath', 'source', 'destination'];
  for (const key of candidates) {
    if (input[key] && typeof input[key] === 'string') return input[key] as string;
  }
  return null;
}

/**
 * Attempt to derive the approximate line number of an edit from tool inputs.
 *
 * For `Edit`/`str_replace_editor` tools we find where `old_string` starts in the
 * file content (which is passed as `fileContent`). For `Write`/`write_file` we
 * return 1 (top of file) since the whole file was replaced.
 *
 * If `fileContent` is not supplied we fall back to heuristic extraction from input
 * fields like `line`, `line_number`, `offset`, etc.
 *
 * Returns `undefined` when no reasonable hint can be derived.
 */
export function extractEditLineHint(
  toolName: string,
  input: Record<string, unknown>,
  fileContent?: string,
): number | undefined {
  // For full-file writes, scroll to top
  const writeTools = ['write_file', 'create_file', 'Write'];
  if (writeTools.includes(toolName)) return 1;

  // For edit / str_replace tools, try to find old_string position in file content
  const editTools = ['edit_file', 'str_replace_editor', 'Edit', 'edit_block'];
  if (editTools.includes(toolName)) {
    const oldString = input.old_string ?? input.oldText ?? input.search;
    if (typeof oldString === 'string' && fileContent) {
      const idx = fileContent.indexOf(oldString);
      if (idx >= 0) {
        // Count newlines before the match to get the line number
        const lineNum = fileContent.substring(0, idx).split('\n').length;
        return lineNum;
      }
    }
    // Explicit line number parameters (some tools use these)
    for (const key of ['line', 'line_number', 'lineNumber', 'start_line']) {
      const val = input[key];
      if (typeof val === 'number' && val > 0) return val;
      if (typeof val === 'string' && /^\d+$/.test(val)) return parseInt(val, 10);
    }
  }

  return undefined;
}
