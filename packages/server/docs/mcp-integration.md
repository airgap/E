# MCP (Model Context Protocol) Integration

## Overview

E now supports **MCP (Model Context Protocol)** integration across all providers (Bedrock, Ollama). MCP allows you to connect external tool servers that extend the AI's capabilities with custom tools.

MCP tools are automatically discovered from configured servers and integrated alongside built-in tools, enabling the AI to seamlessly use both native and external capabilities.

## What is MCP?

The Model Context Protocol (MCP) is a standardized protocol for integrating external tools with AI systems. It uses JSON-RPC 2.0 over stdio to communicate with tool servers, allowing:

- **Dynamic tool discovery** - Tools are discovered at runtime from configured servers
- **Standardized execution** - All tools follow the same JSON-RPC protocol
- **Extensibility** - Add new capabilities without modifying core code
- **Security** - Dangerous tools require user approval before execution

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Bedrock / Ollama                     │
│                    Provider V2                          │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │  getAllToolsWithMcp()  │
         │   (tool-schemas.ts)    │
         └────────┬───────────────┘
                  │
                  ├──► Built-in Tools (Read, Write, Bash, etc.)
                  │
                  └──► MCP Tools (via mcp-tool-adapter.ts)
                       │
                       ├──► discoverAllMcpTools()
                       │    └──► JSON-RPC: initialize + tools/list
                       │
                       └──► executeMcpTool()
                            └──► JSON-RPC: initialize + tools/call
```

## Configuration

### Database Schema

MCP servers are stored in the `mcp_servers` table:

```sql
CREATE TABLE mcp_servers (
  name TEXT PRIMARY KEY,
  transport TEXT NOT NULL,  -- 'stdio', 'sse', or 'http'
  command TEXT,             -- For stdio: executable path
  args TEXT,                -- JSON array of command arguments
  url TEXT,                 -- For sse/http: server URL
  env TEXT,                 -- JSON object of environment variables
  scope TEXT NOT NULL DEFAULT 'local',
  status TEXT NOT NULL DEFAULT 'disconnected'
);
```

### Adding an MCP Server

```typescript
// Example: Add a filesystem MCP server
const db = getDb();
db.query(
  `
  INSERT INTO mcp_servers (name, transport, command, args, env, scope, status)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`,
).run(
  'filesystem',
  'stdio',
  'npx',
  JSON.stringify(['-y', '@modelcontextprotocol/server-filesystem', '/home/user/documents']),
  JSON.stringify({ NODE_ENV: 'production' }),
  'local',
  'disconnected',
);

// Clear the tool cache to pick up new server
import { clearMcpToolCache } from './services/mcp-tool-adapter';
clearMcpToolCache();
```

## MCP Tool Format

MCP tools use a namespaced format: `mcp__<server>__<tool>`

Examples:

- `mcp__filesystem__read_file`
- `mcp__database__execute_query`
- `mcp__github__create_issue`

This format:

- Prevents name collisions between servers
- Makes it clear which server provides the tool
- Allows filtering by server name

## Tool Discovery

Tools are discovered automatically when providers initialize:

1. **Server Enumeration** - All configured MCP servers are loaded from the database
2. **JSON-RPC Handshake** - Each server receives:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "initialize",
     "params": {
       "protocolVersion": "2024-11-05",
       "capabilities": {},
       "clientInfo": { "name": "e-mcp-adapter", "version": "1.0.0" }
     }
   }
   ```
3. **Tool Listing** - Request available tools:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 2,
     "method": "tools/list",
     "params": {}
   }
   ```
4. **Schema Conversion** - MCP tool schemas are converted to Anthropic/Bedrock format
5. **Caching** - Discovered tools are cached for 5 minutes to reduce overhead

### Tool Cache

```typescript
// Tools are cached for 5 minutes
const CACHE_TTL = 5 * 60 * 1000;

// Force refresh when servers change
import { clearMcpToolCache } from './services/mcp-tool-adapter';
clearMcpToolCache();
```

## Tool Execution

When the AI wants to use an MCP tool:

1. **Detection** - `executeTool()` checks if the tool name starts with `mcp__`
2. **Routing** - MCP tools are routed to `executeMcpTool()`
3. **Server Lookup** - The server config is loaded from the database
4. **Process Spawn** - A new process is spawned for the MCP server
5. **JSON-RPC Call**:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 2,
     "method": "tools/call",
     "params": {
       "name": "read_file",
       "arguments": { "path": "/home/user/file.txt" }
     }
   }
   ```
6. **Result Parsing** - The response is parsed and returned:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 2,
     "result": {
       "content": [{ "type": "text", "text": "File contents here..." }]
     }
   }
   ```

### Execution Timeouts

- **Discovery**: 5 seconds per server
- **Execution**: 30 seconds per tool call

Timeouts prevent hanging on unresponsive servers.

## Security

### Dangerous Tool Detection

MCP tools are classified as dangerous if they:

- Modify the filesystem (write, delete operations)
- Execute commands (shell, eval operations)
- Access external resources (network, API calls)

The dangerous tool detection is in `@e/shared`:

```typescript
export function isMcpToolDangerous(fullName: string): boolean {
  const parsed = parseMcpToolName(fullName);
  if (!parsed.isMcp || !parsed.toolName) return false;

  const dangerousPatterns = [
    'write',
    'delete',
    'remove',
    'exec',
    'run',
    'shell',
    'command',
    'eval',
    'create',
    'update',
  ];

  return dangerousPatterns.some((pattern) => parsed.toolName.toLowerCase().includes(pattern));
}
```

### Approval Workflow

Dangerous MCP tools require user approval:

```typescript
// In bedrock-provider-v2.ts and ollama-provider-v2.ts
if (requiresApproval(toolName)) {
  // Emit approval request
  controller.enqueue(
    encoder.encode(
      `data: ${JSON.stringify({
        type: 'tool_approval_request',
        tool_use_id: content.id,
        tool_name: content.name,
        tool_input: content.input,
      })}\n\n`,
    ),
  );

  // Wait for user response
  const approved = await approvalManager.requestApproval(content.id, content.name);
  if (!approved) {
    // Return error result
    continue;
  }
}
```

## Provider Integration

### Bedrock Provider V2

```typescript
// In createBedrockStreamV2()
const tools = await getAllToolsWithMcp(opts.allowedTools, opts.disallowedTools);

// Tools are included in API payload
const payload = {
  anthropic_version: 'bedrock-2023-05-31',
  max_tokens: 4096,
  messages,
  tools, // Includes both built-in and MCP tools
};
```

### Ollama Provider V2

```typescript
// In createOllamaStreamV2()
const useTools = supportsTools(opts.model);
const tools = useTools ? await getAllToolsWithMcp(opts.allowedTools, opts.disallowedTools) : [];

// Convert to Ollama format
const body = {
  model: opts.model,
  messages,
  stream: true,
  tools: toOllamaFunctions(tools), // Includes MCP tools
};
```

## Error Handling

### Discovery Errors

If MCP tool discovery fails, the system gracefully degrades to built-in tools only:

```typescript
try {
  const mcpTools = await getCachedMcpTools();
  const mcpSchemas = mcpToolsToSchemas(mcpTools);
  tools = [...tools, ...mcpSchemas];
} catch (error) {
  console.warn('[tool-schemas] Failed to discover MCP tools:', error);
  // Continue with built-in tools only
}
```

### Execution Errors

Execution errors are returned as tool results:

```typescript
{
  content: "MCP Error: File not found",
  is_error: true
}
```

The AI receives the error and can retry or handle it gracefully.

## Performance Considerations

### Caching Strategy

- **5-minute cache TTL** - Balances freshness with performance
- **In-memory storage** - Fast access, no database overhead
- **Per-server discovery** - Parallel discovery for multiple servers

### Optimization Tips

1. **Minimize servers** - Only configure servers you actively use
2. **Use stdio transport** - Faster than HTTP/SSE for local tools
3. **Clear cache judiciously** - Only when servers change
4. **Monitor timeouts** - Adjust if servers are slow to respond

## Example: Popular MCP Servers

### Filesystem Server

```bash
npx -y @modelcontextprotocol/server-filesystem /path/to/directory
```

Provides:

- `mcp__filesystem__read_file` - Read file contents
- `mcp__filesystem__write_file` - Write to file
- `mcp__filesystem__list_directory` - List directory contents
- `mcp__filesystem__search_files` - Search for files

### Database Server

```bash
npx -y @modelcontextprotocol/server-postgres postgres://user:pass@localhost/db
```

Provides:

- `mcp__postgres__execute_query` - Run SQL queries
- `mcp__postgres__describe_table` - Get table schema
- `mcp__postgres__list_tables` - List all tables

### GitHub Server

```bash
npx -y @modelcontextprotocol/server-github
```

Provides:

- `mcp__github__create_issue` - Create GitHub issue
- `mcp__github__search_repositories` - Search repos
- `mcp__github__get_file_contents` - Read file from repo

## Debugging

### Enable Debug Logging

Set environment variable:

```bash
DEBUG=mcp:* bun run dev
```

### Check Tool Discovery

```typescript
import { discoverAllMcpTools } from './services/mcp-tool-adapter';

const tools = await discoverAllMcpTools();
console.log(
  'Discovered MCP tools:',
  tools.map((t) => t.fullName),
);
```

### Test Tool Execution

```typescript
import { executeMcpTool } from './services/mcp-tool-adapter';

const result = await executeMcpTool('mcp__filesystem__read_file', {
  path: '/home/user/test.txt',
});
console.log('Tool result:', result);
```

### Inspect Server Communication

Watch JSON-RPC messages by logging in `mcp-tool-adapter.ts`:

```typescript
console.log('[mcp] Sending:', initRequest);
proc.stdout.on('data', (data) => {
  console.log('[mcp] Received:', data.toString());
  output += data.toString();
});
```

## Limitations

1. **stdio only** - Currently only stdio transport is implemented
   - SSE and HTTP transports are recognized but not executed
   - Future updates will add support for remote MCP servers

2. **No streaming** - Tool execution is synchronous
   - Large operations may cause timeouts
   - Consider increasing timeout for heavy tools

3. **No bidirectional communication** - Tools can't ask questions back
   - MCP protocol supports this, but not yet implemented
   - Would require integration with approval workflow

4. **Single process per call** - Each tool execution spawns a new process
   - Could be optimized with persistent server processes
   - Current approach ensures isolation but has overhead

## Future Enhancements

- [ ] HTTP/SSE transport support for remote MCP servers
- [ ] Persistent server processes with connection pooling
- [ ] Bidirectional communication for interactive tools
- [ ] Tool execution metrics and monitoring
- [ ] Server health checking and auto-restart
- [ ] Tool schema validation and versioning
- [ ] Rate limiting per server
- [ ] Tool execution sandboxing
- [ ] Support for MCP resources and prompts (not just tools)

## Related Files

- `src/services/mcp-tool-adapter.ts` - Core MCP integration logic
- `src/services/tool-schemas.ts` - Tool schema management
- `src/services/tool-executor.ts` - Tool execution routing
- `src/services/bedrock-provider-v2.ts` - Bedrock MCP integration
- `src/services/ollama-provider-v2.ts` - Ollama MCP integration
- `shared/src/mcp-tools.ts` - MCP utilities and name parsing
- `src/routes/mcp.ts` - MCP server management API
- `src/services/mcp-config.ts` - MCP configuration generation
