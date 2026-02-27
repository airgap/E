import { describe, test, expect } from 'bun:test';

import { toolRoutes as app } from '../tools';

describe('Tool Routes', () => {
  // ---------------------------------------------------------------
  // GET / — List available tools
  // ---------------------------------------------------------------
  describe('GET / — list tools', () => {
    test('returns a successful response', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    test('returns all 20 built-in tools', async () => {
      const res = await app.request('/');
      const json = await res.json();
      expect(json.data).toHaveLength(20);
    });

    test('each tool has required fields', async () => {
      const res = await app.request('/');
      const json = await res.json();
      for (const tool of json.data) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe('string');
        expect(tool.category).toBeDefined();
        expect(typeof tool.category).toBe('string');
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.requiresApproval).toBe('boolean');
        expect(tool.source).toBe('builtin');
      }
    });

    test('contains expected tool names', async () => {
      const res = await app.request('/');
      const json = await res.json();
      const names = json.data.map((t: any) => t.name);

      const expectedNames = [
        'Read',
        'Write',
        'Edit',
        'Glob',
        'Grep',
        'Bash',
        'WebFetch',
        'WebSearch',
        'Task',
        'TaskCreate',
        'TaskUpdate',
        'TaskList',
        'TaskGet',
        'EnterPlanMode',
        'ExitPlanMode',
        'NotebookEdit',
        'CaptureScreenshot',
        'ListDisplays',
        'CaptureCamera',
        'GetLocation',
      ];

      for (const name of expectedNames) {
        expect(names).toContain(name);
      }
    });

    test('contains device category tools', async () => {
      const res = await app.request('/');
      const json = await res.json();
      const deviceTools = json.data.filter((t: any) => t.category === 'device');
      const deviceNames = deviceTools.map((t: any) => t.name);

      expect(deviceNames).toContain('CaptureScreenshot');
      expect(deviceNames).toContain('ListDisplays');
      expect(deviceNames).toContain('CaptureCamera');
      expect(deviceNames).toContain('GetLocation');
      expect(deviceTools).toHaveLength(4);
    });

    test('contains filesystem category tools', async () => {
      const res = await app.request('/');
      const json = await res.json();
      const fsTools = json.data.filter((t: any) => t.category === 'filesystem');
      const fsNames = fsTools.map((t: any) => t.name);

      expect(fsNames).toContain('Read');
      expect(fsNames).toContain('Write');
      expect(fsNames).toContain('Edit');
      expect(fsNames).toContain('Glob');
      expect(fsNames).toContain('Grep');
      expect(fsTools).toHaveLength(5);
    });

    test('contains execution category tools', async () => {
      const res = await app.request('/');
      const json = await res.json();
      const execTools = json.data.filter((t: any) => t.category === 'execution');
      expect(execTools).toHaveLength(1);
      expect(execTools[0].name).toBe('Bash');
    });

    test('contains web category tools', async () => {
      const res = await app.request('/');
      const json = await res.json();
      const webTools = json.data.filter((t: any) => t.category === 'web');
      const webNames = webTools.map((t: any) => t.name);

      expect(webNames).toContain('WebFetch');
      expect(webNames).toContain('WebSearch');
      expect(webTools).toHaveLength(2);
    });

    test('contains agent category tools', async () => {
      const res = await app.request('/');
      const json = await res.json();
      const agentTools = json.data.filter((t: any) => t.category === 'agent');
      expect(agentTools).toHaveLength(1);
      expect(agentTools[0].name).toBe('Task');
    });

    test('contains task category tools', async () => {
      const res = await app.request('/');
      const json = await res.json();
      const taskTools = json.data.filter((t: any) => t.category === 'task');
      const taskNames = taskTools.map((t: any) => t.name);

      expect(taskNames).toContain('TaskCreate');
      expect(taskNames).toContain('TaskUpdate');
      expect(taskNames).toContain('TaskList');
      expect(taskNames).toContain('TaskGet');
      expect(taskTools).toHaveLength(4);
    });

    test('contains planning category tools', async () => {
      const res = await app.request('/');
      const json = await res.json();
      const planTools = json.data.filter((t: any) => t.category === 'planning');
      const planNames = planTools.map((t: any) => t.name);

      expect(planNames).toContain('EnterPlanMode');
      expect(planNames).toContain('ExitPlanMode');
      expect(planTools).toHaveLength(2);
    });

    test('contains notebook category tools', async () => {
      const res = await app.request('/');
      const json = await res.json();
      const nbTools = json.data.filter((t: any) => t.category === 'notebook');
      expect(nbTools).toHaveLength(1);
      expect(nbTools[0].name).toBe('NotebookEdit');
    });

    test('tools requiring approval are marked correctly', async () => {
      const res = await app.request('/');
      const json = await res.json();

      const requiresApproval = json.data
        .filter((t: any) => t.requiresApproval)
        .map((t: any) => t.name);

      expect(requiresApproval).toContain('Write');
      expect(requiresApproval).toContain('Edit');
      expect(requiresApproval).toContain('Bash');
      expect(requiresApproval).toContain('NotebookEdit');
    });

    test('tools not requiring approval are marked correctly', async () => {
      const res = await app.request('/');
      const json = await res.json();

      const noApproval = json.data.filter((t: any) => !t.requiresApproval).map((t: any) => t.name);

      expect(noApproval).toContain('Read');
      expect(noApproval).toContain('Glob');
      expect(noApproval).toContain('Grep');
      expect(noApproval).toContain('WebFetch');
      expect(noApproval).toContain('WebSearch');
      expect(noApproval).toContain('Task');
      expect(noApproval).toContain('TaskCreate');
      expect(noApproval).toContain('TaskUpdate');
      expect(noApproval).toContain('TaskList');
      expect(noApproval).toContain('TaskGet');
      expect(noApproval).toContain('EnterPlanMode');
      expect(noApproval).toContain('ExitPlanMode');
      expect(noApproval).toContain('CaptureScreenshot');
      expect(noApproval).toContain('ListDisplays');
      expect(noApproval).toContain('CaptureCamera');
      expect(noApproval).toContain('GetLocation');
    });

    test('all tools have source set to builtin', async () => {
      const res = await app.request('/');
      const json = await res.json();
      const sources = [...new Set(json.data.map((t: any) => t.source))];
      expect(sources).toEqual(['builtin']);
    });
  });
});
