# Tool Calling Implementation Guide

This document describes the tool calling architecture for all providers.

## Current State

- **Claude CLI** ✅ Full tool calling support via built-in tools
- **Claude API** ✅ Full tool calling support via Anthropic API
- **Kiro CLI** ✅ Tool calling via ACP protocol
- **Bedrock** ✅ Full tool calling + MCP integration (via `bedrock-provider-v2.ts`)
- **Ollama** ✅ Tool calling for supported models + MCP integration (via `ollama-provider-v2.ts`)

## Architecture Overview

Tool calling in E follows this flow:

```
User Message
    ↓
Model Request (with tool definitions)
    ↓
Model Response (stop_reason: "tool_use")
    ↓
Tool Approval Check (if dangerous)
    ↓
Tool Execution
    ↓
Tool Result → Model
    ↓
Final Response
```

## Tool Definition Format

### Anthropic/Bedrock Format

```typescript
interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
      }
    >;
    required?: string[];
  };
}
```

### Example: Read Tool

```json
{
  "name": "Read",
  "description": "Read file contents from the filesystem. Returns the full text content of the specified file.",
  "input_schema": {
    "type": "object",
    "properties": {
      "file_path": {
        "type": "string",
        "description": "Absolute path to the file to read"
      },
      "offset": {
        "type": "integer",
        "description": "Optional line number to start reading from (1-indexed)"
      },
      "limit": {
        "type": "integer",
        "description": "Optional maximum number of lines to read"
      }
    },
    "required": ["file_path"]
  }
}
```

## Built-in Tools to Implement

### Filesystem Tools

1. **Read** - Read file contents
2. **Write** - Create/overwrite files (requires approval)
3. **Edit** - Edit existing files with replacements (requires approval)
4. **Glob** - Find files by pattern
5. **Grep** - Search file contents

### Execution Tools

6. **Bash** - Execute shell commands (requires approval)

### Web Tools

7. **WebFetch** - Fetch URL content
8. **WebSearch** - Search the web

### Agent Tools

9. **Task** - Spawn sub-agents
10. **TodoWrite** - Manage todo lists

### Planning Tools

11. **EnterPlanMode** - Enter planning mode
12. **ExitPlanMode** - Exit planning mode
13. **AskUserQuestion** - Ask clarifying questions

### Notebook Tools

14. **NotebookEdit** - Edit Jupyter notebooks (requires approval)

## Implementation Steps for Bedrock

### Step 1: Define Tool Schema Converter

Create `src/services/tool-schemas.ts`:

```typescript
export function getToolDefinitions(): Array<BedrockTool> {
  return [
    {
      name: 'Read',
      description: 'Read file contents from the filesystem',
      input_schema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to file' },
          offset: { type: 'integer', description: 'Line to start from' },
          limit: { type: 'integer', description: 'Max lines to read' },
        },
        required: ['file_path'],
      },
    },
    // ... more tools
  ];
}

export function shouldRequireApproval(toolName: string): boolean {
  const dangerousTools = ['Write', 'Edit', 'Bash', 'NotebookEdit'];
  return dangerousTools.includes(toolName);
}
```

### Step 2: Update Bedrock Provider

Modify `bedrock-provider.ts` to:

1. Include tools array in request
2. Handle `tool_use` content blocks in response
3. Execute tools and send results back
4. Emit tool approval events

```typescript
// Add to request payload
const payload = {
  anthropic_version: 'bedrock-2023-05-31',
  max_tokens: 4096,
  messages,
  tools: getToolDefinitions(), // <-- Add tools
  system: opts.systemPrompt,
};
```

### Step 3: Tool Execution Handler

Create `src/services/tool-executor.ts`:

```typescript
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  workspacePath: string,
): Promise<{ content: string; is_error?: boolean }> {
  switch (toolName) {
    case 'Read':
      return executeReadTool(toolInput);
    case 'Write':
      return executeWriteTool(toolInput);
    case 'Bash':
      return executeBashTool(toolInput, workspacePath);
    // ... more tools
    default:
      return {
        content: `Unknown tool: ${toolName}`,
        is_error: true,
      };
  }
}
```

### Step 4: Handle Tool Use in Stream

```typescript
// In bedrock-provider.ts stream handling
if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
  const tool = chunk.content_block;

  // Emit tool approval request if needed
  if (shouldRequireApproval(tool.name)) {
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({
          type: 'tool_approval_request',
          tool_use_id: tool.id,
          tool_name: tool.name,
          tool_input: tool.input,
        })}\n\n`,
      ),
    );

    // Wait for approval...
    const approved = await waitForApproval(tool.id);
    if (!approved) {
      // Send tool denial result
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: tool.id,
            content: 'Tool execution denied by user',
            is_error: true,
          },
        ],
      });
      continue;
    }
  }

  // Execute tool
  const result = await executeTool(tool.name, tool.input, opts.workspacePath);

  // Send result back to model
  messages.push({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: tool.id,
        content: result.content,
        is_error: result.is_error,
      },
    ],
  });

  // Continue conversation with tool result
  // Make another API call with updated messages array
}
```

## Implementation Steps for Ollama

### Challenge: Limited Tool Support

Ollama has experimental tool calling support, but it varies by model and is not standardized.

### Option 1: Use Ollama with Tool-Capable Models

Some models like `llama3.1` and `qwen2.5` support function calling:

```typescript
const payload = {
  model: ollamaModel,
  messages,
  stream: true,
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_current_weather',
        description: 'Get the current weather',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state',
            },
          },
          required: ['location'],
        },
      },
    },
  ],
};
```

### Option 2: Prompt-Based Tool Calling

Fallback for models without native tool support:

```typescript
const systemPrompt = `You have access to these tools:
- Read(file_path: string): Read file contents
- Write(file_path: string, content: string): Write file
- Bash(command: string): Execute shell command

To use a tool, respond ONLY with a JSON object:
{"tool": "Read", "input": {"file_path": "/path/to/file"}}

After tool results are provided, continue the conversation normally.`;
```

Parse responses for tool invocations and execute them manually.

## Testing Strategy

### Unit Tests

```typescript
describe('Tool Execution', () => {
  test('executes Read tool', async () => {
    const result = await executeTool(
      'Read',
      {
        file_path: '/tmp/test.txt',
      },
      '/workspace',
    );
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('file contents');
  });

  test('requires approval for Bash', () => {
    expect(shouldRequireApproval('Bash')).toBe(true);
  });
});
```

### Integration Tests

1. Test full tool calling cycle with Bedrock
2. Test tool approval flow
3. Test multi-turn tool sequences
4. Test tool error handling

## Implementation Status

### Phase 1: Bedrock Tool Calling ✅

- [x] Implement tool schema definitions (`tool-schemas.ts`)
- [x] Update Bedrock provider for tool support (`bedrock-provider-v2.ts`)
- [x] Implement basic tool executor (`tool-executor.ts`)
- [x] Test with Read, Glob, Grep tools

### Phase 2: Dangerous Tool Approval ✅

- [x] Implement approval request flow
- [x] Add Write, Edit, Bash tool execution
- [x] Test approval UI integration

### Phase 3: MCP Tool Integration ✅

- [x] Map MCP tools to Bedrock format (`mcp-tool-adapter.ts`)
- [x] Handle MCP tool execution
- [x] Test with real MCP servers

### Phase 4: Ollama Tool Support ✅

- [x] Detect tool-capable Ollama models (`ollama-provider-v2.ts`)
- [x] Implement Ollama-specific tool format
- [x] MCP integration for Ollama

### Phase 5: Vision Support ✅

- [x] Add image input support to Bedrock
- [x] Add image input support to Ollama (model-dependent)
- [ ] Add screenshot tools
- [ ] Test multi-modal workflows

## Performance Considerations

1. **Caching**: Cache tool schemas per session
2. **Parallel Execution**: Execute independent tools in parallel
3. **Streaming**: Stream tool results as they execute
4. **Timeout**: Add timeouts for long-running tools

## Security Considerations

1. **Sandbox**: All file operations must respect workspace boundaries
2. **Approval**: Dangerous tools (Write, Bash) require explicit approval
3. **Validation**: Validate all tool inputs against schema
4. **Rate Limiting**: Limit tool execution rate to prevent abuse

## Resources

- [AWS Bedrock Tool Use Docs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages-tool-use.html)
- [Anthropic Tool Use Guide](https://docs.anthropic.com/claude/docs/tool-use)
- [Ollama Function Calling](https://ollama.com/blog/tool-support)
- [MCP Specification](https://modelcontextprotocol.io/introduction)

## Example: Complete Tool Calling Flow

```typescript
// 1. Initial request with tools
POST /bedrock/invoke
{
  "messages": [{"role": "user", "content": "What's in README.md?"}],
  "tools": [Read tool definition]
}

// 2. Model responds with tool use
{
  "stop_reason": "tool_use",
  "content": [{
    "type": "tool_use",
    "id": "toolu_123",
    "name": "Read",
    "input": {"file_path": "README.md"}
  }]
}

// 3. Execute tool
const result = await fs.readFile('README.md', 'utf-8');

// 4. Send tool result back
POST /bedrock/invoke
{
  "messages": [
    {"role": "user", "content": "What's in README.md?"},
    {"role": "assistant", "content": [{tool_use from step 2}]},
    {"role": "user", "content": [{
      "type": "tool_result",
      "tool_use_id": "toolu_123",
      "content": result
    }]}
  ],
  "tools": [Read tool definition]
}

// 5. Final response
{
  "stop_reason": "end_turn",
  "content": [{
    "type": "text",
    "text": "The README.md file contains..."
  }]
}
```

## Related Files

- `src/services/tool-schemas.ts` - Tool definitions in Anthropic/Bedrock format
- `src/services/tool-executor.ts` - Tool execution engine
- `src/services/bedrock-provider-v2.ts` - Bedrock with full tool calling
- `src/services/ollama-provider-v2.ts` - Ollama with tool calling
- `src/services/mcp-tool-adapter.ts` - MCP server integration and tool discovery
- `src/routes/stream.ts` - Stream routing with provider selection
