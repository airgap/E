import { describe, test, expect } from 'vitest';
import { SIDEBAR_TABS, getTabDef } from '../sidebarTabs';

describe('SIDEBAR_TABS', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(SIDEBAR_TABS)).toBe(true);
    expect(SIDEBAR_TABS.length).toBeGreaterThan(0);
  });

  test('every entry has required properties', () => {
    for (const tab of SIDEBAR_TABS) {
      expect(tab.id).toBeTruthy();
      expect(tab.label).toBeTruthy();
      expect(tab.icon).toBeTruthy();
    }
  });

  test('all ids are unique', () => {
    const ids = SIDEBAR_TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('contains conversations tab', () => {
    const ids = SIDEBAR_TABS.map((t) => t.id);
    expect(ids).toContain('conversations');
  });

  test('contains files tab', () => {
    const ids = SIDEBAR_TABS.map((t) => t.id);
    expect(ids).toContain('files');
  });

  test('contains search tab', () => {
    const ids = SIDEBAR_TABS.map((t) => t.id);
    expect(ids).toContain('search');
  });

  test('contains known core tabs', () => {
    const ids = SIDEBAR_TABS.map((t) => t.id);
    expect(ids).toContain('conversations');
    expect(ids).toContain('files');
    expect(ids).toContain('search');
    expect(ids).toContain('symbols');
    expect(ids).toContain('work');
    expect(ids).toContain('memory');
    expect(ids).toContain('agents');
    expect(ids).toContain('mcp');
    expect(ids).toContain('help');
    expect(ids).toContain('git');
  });

  test('all icons are non-empty SVG path strings', () => {
    for (const tab of SIDEBAR_TABS) {
      expect(typeof tab.icon).toBe('string');
      expect(tab.icon.length).toBeGreaterThan(0);
      // SVG paths typically start with M (moveto) or contain path commands
      expect(tab.icon).toMatch(/[MLHVCSQTAZmlhvcsqtaz]/);
    }
  });

  test('all labels are human-readable non-empty strings', () => {
    for (const tab of SIDEBAR_TABS) {
      expect(typeof tab.label).toBe('string');
      expect(tab.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('getTabDef', () => {
  test('returns correct tab definition for conversations', () => {
    const tab = getTabDef('conversations');
    expect(tab.id).toBe('conversations');
    expect(tab.label).toBe('Chats');
    expect(tab.icon).toBeTruthy();
  });

  test('returns correct tab definition for files', () => {
    const tab = getTabDef('files');
    expect(tab.id).toBe('files');
    expect(tab.label).toBe('Files');
  });

  test('returns correct tab definition for search', () => {
    const tab = getTabDef('search');
    expect(tab.id).toBe('search');
    expect(tab.label).toBe('Search');
  });

  test('returns correct tab definition for mcp', () => {
    const tab = getTabDef('mcp');
    expect(tab.id).toBe('mcp');
    expect(tab.label).toBe('MCP');
  });

  test('returns correct tab definition for help', () => {
    const tab = getTabDef('help');
    expect(tab.id).toBe('help');
    expect(tab.label).toBe('Help');
  });

  test('returns correct tab definition for git', () => {
    const tab = getTabDef('git');
    expect(tab.id).toBe('git');
    expect(tab.label).toBe('Git');
  });

  test('throws for unknown tab id', () => {
    expect(() => getTabDef('nonexistent' as any)).toThrow('Unknown sidebar tab: nonexistent');
  });

  test('throws with descriptive error message', () => {
    expect(() => getTabDef('foobar' as any)).toThrow(/foobar/);
  });

  test('returns the same object from SIDEBAR_TABS', () => {
    const fromArray = SIDEBAR_TABS.find((t) => t.id === 'files');
    const fromFn = getTabDef('files');
    expect(fromFn).toBe(fromArray);
  });
});
