import { Hono } from 'hono';

const app = new Hono();

// List available tools (built-in + MCP)
app.get('/', (c) => {
  const builtinTools = [
    {
      name: 'Read',
      category: 'filesystem',
      description: 'Read file contents',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'Write',
      category: 'filesystem',
      description: 'Create or overwrite files',
      requiresApproval: true,
      source: 'builtin',
    },
    {
      name: 'Edit',
      category: 'filesystem',
      description: 'Edit existing files with surgical replacements',
      requiresApproval: true,
      source: 'builtin',
    },
    {
      name: 'Glob',
      category: 'filesystem',
      description: 'Find files by pattern',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'Grep',
      category: 'filesystem',
      description: 'Search file contents',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'Bash',
      category: 'execution',
      description: 'Execute shell commands',
      requiresApproval: true,
      source: 'builtin',
    },
    {
      name: 'WebFetch',
      category: 'web',
      description: 'Fetch URL content',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'WebSearch',
      category: 'web',
      description: 'Search the web',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'Task',
      category: 'agent',
      description: 'Spawn sub-agents',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'TaskCreate',
      category: 'task',
      description: 'Create a todo task',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'TaskUpdate',
      category: 'task',
      description: 'Update a todo task',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'TaskList',
      category: 'task',
      description: 'List all tasks',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'TaskGet',
      category: 'task',
      description: 'Get task details',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'EnterPlanMode',
      category: 'planning',
      description: 'Enter planning mode',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'ExitPlanMode',
      category: 'planning',
      description: 'Exit planning mode with approval',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'NotebookEdit',
      category: 'notebook',
      description: 'Edit Jupyter notebooks',
      requiresApproval: true,
      source: 'builtin',
    },
    {
      name: 'CaptureScreenshot',
      category: 'device',
      description: 'Capture screenshots for visual debugging',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'ListDisplays',
      category: 'device',
      description: 'List available displays for screenshot capture',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'CaptureCamera',
      category: 'device',
      description: 'Capture from camera for barcode/document scanning',
      requiresApproval: false,
      source: 'builtin',
    },
    {
      name: 'GetLocation',
      category: 'device',
      description: 'Get approximate location for timezone-aware scheduling',
      requiresApproval: false,
      source: 'builtin',
    },
  ];

  return c.json({ ok: true, data: builtinTools });
});

export { app as toolRoutes };
