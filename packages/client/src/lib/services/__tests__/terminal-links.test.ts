import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockEditorStore, mockTerminalStore } = vi.hoisted(() => ({
  mockEditorStore: { openFile: vi.fn() },
  mockTerminalStore: { sessions: new Map<string, { cwd: string }>() },
}));

vi.mock('@xterm/xterm', () => ({}));
vi.mock('@xterm/addon-web-links', () => ({}));
vi.mock('$lib/stores/editor.svelte', () => ({
  editorStore: mockEditorStore,
}));
vi.mock('$lib/stores/terminal.svelte', () => ({
  terminalStore: mockTerminalStore,
}));

import {
  resolvePath,
  createUrlClickHandler,
  createUrlLinkOptions,
  createFilePathLinkProvider,
} from '../terminal-links';

beforeEach(() => {
  vi.clearAllMocks();
  mockTerminalStore.sessions.clear();
});

// ============================================================================
// resolvePath
// ============================================================================
describe('resolvePath', () => {
  test('returns absolute paths as-is', () => {
    expect(resolvePath('/usr/local/bin/node', '/home/user')).toBe('/usr/local/bin/node');
  });

  test('returns home-relative paths as-is', () => {
    expect(resolvePath('~/Documents/file.ts', '/home/user')).toBe('~/Documents/file.ts');
  });

  test('resolves relative path against cwd', () => {
    expect(resolvePath('src/foo.ts', '/home/user/project')).toBe('/home/user/project/src/foo.ts');
  });

  test('resolves ./ prefix path against cwd', () => {
    expect(resolvePath('./src/foo.ts', '/home/user/project')).toBe('/home/user/project/src/foo.ts');
  });

  test('resolves ../ segments', () => {
    expect(resolvePath('../other/file.ts', '/home/user/project')).toBe('/home/user/other/file.ts');
  });

  test('handles cwd with trailing slash', () => {
    expect(resolvePath('foo.ts', '/home/user/')).toBe('/home/user/foo.ts');
  });

  test('handles cwd without trailing slash', () => {
    expect(resolvePath('foo.ts', '/home/user')).toBe('/home/user/foo.ts');
  });

  test('double dot parent resolution works', () => {
    expect(resolvePath('../../up/two.ts', '/a/b/c')).toBe('/a/up/two.ts');
  });
});

// ============================================================================
// createUrlClickHandler
// ============================================================================
describe('createUrlClickHandler', () => {
  let mockWindowOpen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockWindowOpen = vi.fn();
    vi.stubGlobal('open', mockWindowOpen);
    Object.defineProperty(window, 'open', { value: mockWindowOpen, writable: true });
  });

  test('opens URL when ctrlKey is held', () => {
    const handler = createUrlClickHandler();
    handler({ ctrlKey: true, metaKey: false } as MouseEvent, 'https://example.com');
    expect(mockWindowOpen).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
  });

  test('opens URL when metaKey is held', () => {
    const handler = createUrlClickHandler();
    handler({ ctrlKey: false, metaKey: true } as MouseEvent, 'https://example.com');
    expect(mockWindowOpen).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
  });

  test('does not open URL without modifier key', () => {
    const handler = createUrlClickHandler();
    handler({ ctrlKey: false, metaKey: false } as MouseEvent, 'https://example.com');
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });
});

// ============================================================================
// createUrlLinkOptions
// ============================================================================
describe('createUrlLinkOptions', () => {
  function createMockTerminal() {
    const container = document.createElement('div');
    return {
      element: container,
      buffer: {
        active: {
          getLine: vi.fn(),
        },
      },
    } as any;
  }

  test('returns hover and leave functions', () => {
    const terminal = createMockTerminal();
    const options = createUrlLinkOptions(terminal);
    expect(typeof options.hover).toBe('function');
    expect(typeof options.leave).toBe('function');
  });

  test('hover creates a tooltip element', () => {
    const terminal = createMockTerminal();
    const options = createUrlLinkOptions(terminal);

    // Simulate getBoundingClientRect
    terminal.element.getBoundingClientRect = () => ({
      left: 100,
      top: 200,
      right: 500,
      bottom: 600,
      width: 400,
      height: 400,
      x: 100,
      y: 200,
      toJSON: () => {},
    });

    options.hover!(
      { clientX: 150, clientY: 250 } as MouseEvent,
      'https://example.com',
      undefined as any,
    );

    const tooltip = terminal.element.querySelector('.terminal-link-tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain('Click to follow link');
  });

  test('leave removes tooltip elements', () => {
    const terminal = createMockTerminal();
    const options = createUrlLinkOptions(terminal);

    // Add a tooltip manually
    const tip = document.createElement('div');
    tip.className = 'terminal-link-tooltip';
    terminal.element.appendChild(tip);

    options.leave!({} as MouseEvent, 'https://example.com');

    const remaining = terminal.element.querySelectorAll('.terminal-link-tooltip');
    expect(remaining.length).toBe(0);
  });

  test('hover replaces existing tooltip', () => {
    const terminal = createMockTerminal();
    const options = createUrlLinkOptions(terminal);

    terminal.element.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Call hover twice — should only have one tooltip
    options.hover!({ clientX: 50, clientY: 50 } as MouseEvent, 'url1', undefined as any);
    options.hover!({ clientX: 60, clientY: 60 } as MouseEvent, 'url2', undefined as any);

    const tooltips = terminal.element.querySelectorAll('.terminal-link-tooltip');
    expect(tooltips.length).toBe(1);
  });
});

// ============================================================================
// createFilePathLinkProvider
// ============================================================================
describe('createFilePathLinkProvider', () => {
  function createMockTerminal(lineText: string | null) {
    const container = document.createElement('div');
    return {
      element: container,
      buffer: {
        active: {
          getLine: vi
            .fn()
            .mockReturnValue(lineText !== null ? { translateToString: () => lineText } : null),
        },
      },
    } as any;
  }

  test('returns an ILinkProvider with provideLinks method', () => {
    const terminal = createMockTerminal('');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    expect(typeof provider.provideLinks).toBe('function');
  });

  test('calls callback with undefined when buffer line is null', () => {
    const terminal = createMockTerminal(null);
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    expect(callback).toHaveBeenCalledWith(undefined);
  });

  test('calls callback with undefined when no file links found', () => {
    const terminal = createMockTerminal('just some text without file paths');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    expect(callback).toHaveBeenCalledWith(undefined);
  });

  test('detects absolute file path links', () => {
    const terminal = createMockTerminal('Error in /home/user/src/app.ts:42:10');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          text: '/home/user/src/app.ts:42:10',
        }),
      ]),
    );
  });

  test('detects relative path with directory segments', () => {
    const terminal = createMockTerminal('at src/utils/helper.ts:5:3');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/project');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'src/utils/helper.ts:5:3',
        }),
      ]),
    );
  });

  test('detects ./ prefix paths', () => {
    const terminal = createMockTerminal('Error in ./lib/index.ts');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/project');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          text: './lib/index.ts',
        }),
      ]),
    );
  });

  test('detects ../ prefix paths', () => {
    const terminal = createMockTerminal('See ../common/types.ts:10');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/project/sub');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('../common/types.ts'),
        }),
      ]),
    );
  });

  test('detects bare filename with colon line number', () => {
    const terminal = createMockTerminal('warning in index.ts:42');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/project');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'index.ts:42',
        }),
      ]),
    );
  });

  test('detects paren-format line:col (TypeScript diagnostics)', () => {
    const terminal = createMockTerminal('error TS2322 file.ts(10,5)');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/project');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'file.ts(10,5)',
        }),
      ]),
    );
  });

  test('uses session CWD when available', () => {
    mockTerminalStore.sessions.set('sess-1', { cwd: '/session/cwd' });
    const terminal = createMockTerminal('Error in ./app.ts:1');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/fallback');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    // Link should exist, and activate should use session CWD
    expect(callback).toHaveBeenCalledWith(expect.any(Array));
    const links = callback.mock.calls[0][0];
    expect(links.length).toBeGreaterThan(0);

    // Simulate activate with modifier key
    links[0].activate({ ctrlKey: true, metaKey: false } as MouseEvent);
    expect(mockEditorStore.openFile).toHaveBeenCalledWith(
      '/session/cwd/app.ts',
      false,
      expect.objectContaining({ line: 1 }),
    );
  });

  test('uses fallback CWD when session has no entry', () => {
    const terminal = createMockTerminal('Error in ./app.ts:5');
    const provider = createFilePathLinkProvider(terminal, 'sess-unknown', '/fallback/path');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0][0];
    links[0].activate({ ctrlKey: true, metaKey: false } as MouseEvent);
    expect(mockEditorStore.openFile).toHaveBeenCalledWith(
      '/fallback/path/app.ts',
      false,
      expect.objectContaining({ line: 5 }),
    );
  });

  test('activate does nothing without modifier key', () => {
    const terminal = createMockTerminal('Error in ./app.ts:1');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0][0];
    links[0].activate({ ctrlKey: false, metaKey: false } as MouseEvent);
    expect(mockEditorStore.openFile).not.toHaveBeenCalled();
  });

  test('activate opens file without goTo when no line number', () => {
    const terminal = createMockTerminal('Error in /absolute/file.ts');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0][0];
    links[0].activate({ ctrlKey: true, metaKey: false } as MouseEvent);
    expect(mockEditorStore.openFile).toHaveBeenCalledWith('/absolute/file.ts', false, undefined);
  });

  test('activate opens file with line and col', () => {
    const terminal = createMockTerminal('Error at /src/app.ts:42:10');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0][0];
    links[0].activate({ ctrlKey: true, metaKey: false } as MouseEvent);
    expect(mockEditorStore.openFile).toHaveBeenCalledWith('/src/app.ts', false, {
      line: 42,
      col: 10,
    });
  });

  test('activate opens file with only line number (col defaults to 1)', () => {
    const terminal = createMockTerminal('Error at /src/app.ts:42');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0][0];
    links[0].activate({ ctrlKey: true, metaKey: false } as MouseEvent);
    expect(mockEditorStore.openFile).toHaveBeenCalledWith('/src/app.ts', false, {
      line: 42,
      col: 1,
    });
  });

  test('hover creates tooltip with path info', () => {
    const terminal = createMockTerminal('Error at /src/app.ts:42:10');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    terminal.element.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0][0];
    links[0].hover({ clientX: 50, clientY: 50 } as MouseEvent);

    const tooltip = terminal.element.querySelector('.terminal-link-tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain('Click to open');
  });

  test('leave removes tooltip', () => {
    const terminal = createMockTerminal('Error at /src/app.ts');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    // Add a fake tooltip
    const tip = document.createElement('div');
    tip.className = 'terminal-link-tooltip';
    terminal.element.appendChild(tip);

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0][0];
    links[0].leave();

    const remaining = terminal.element.querySelectorAll('.terminal-link-tooltip');
    expect(remaining.length).toBe(0);
  });

  test('link range is correct for detected paths', () => {
    const terminal = createMockTerminal('Error in /home/user/app.ts:1');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0][0];
    expect(links[0].range.start.y).toBe(1);
    expect(links[0].range.end.y).toBe(1);
    // range.start.x should be startIndex + 1 (1-based)
    expect(links[0].range.start.x).toBeGreaterThan(0);
  });

  test('links have decorations', () => {
    const terminal = createMockTerminal('/home/user/app.ts');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0][0];
    expect(links[0].decorations).toEqual(
      expect.objectContaining({ pointerCursor: true, underline: true }),
    );
  });

  test('skips version number look-alikes', () => {
    const terminal = createMockTerminal('using v1.2.3 and 2.0.0');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    expect(callback).toHaveBeenCalledWith(undefined);
  });

  test('detects ~/prefix paths', () => {
    const terminal = createMockTerminal('config at ~/config/app.yml');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          text: '~/config/app.yml',
        }),
      ]),
    );
  });

  test('detects multiple links on one line', () => {
    const terminal = createMockTerminal('/foo/bar.ts:1 and /baz/qux.ts:2');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0][0];
    expect(links.length).toBe(2);
  });

  test('hover tooltip shows line and col in label', () => {
    const terminal = createMockTerminal('/app.ts:42:10');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    terminal.element.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0][0];
    links[0].hover({ clientX: 10, clientY: 10 } as MouseEvent);

    const tooltip = terminal.element.querySelector('.terminal-link-tooltip');
    expect(tooltip!.textContent).toContain(':42');
    expect(tooltip!.textContent).toContain(':10');
  });

  test('hover tooltip shows path without line if no line', () => {
    const terminal = createMockTerminal('/src/main.ts here');
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    terminal.element.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0][0];
    links[0].hover({ clientX: 10, clientY: 10 } as MouseEvent);

    const tooltip = terminal.element.querySelector('.terminal-link-tooltip');
    expect(tooltip!.textContent).toContain('/src/main.ts');
  });

  test('hover does nothing when terminal.element is null', () => {
    const terminal = createMockTerminal('/app.ts:1');
    // Make element null for the showTooltip path
    const origElement = terminal.element;
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    // Set element to null before hover
    Object.defineProperty(terminal, 'element', { value: null, writable: true });
    const links = callback.mock.calls[0][0];
    // Should not throw
    links[0].hover({ clientX: 10, clientY: 10 } as MouseEvent);
    // Restore for cleanup
    Object.defineProperty(terminal, 'element', { value: origElement, writable: true });
  });

  test('leave does nothing when terminal.element is null', () => {
    const terminal = createMockTerminal('/app.ts:1');
    const origElement = terminal.element;
    const provider = createFilePathLinkProvider(terminal, 'sess-1', '/cwd');
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    Object.defineProperty(terminal, 'element', { value: null, writable: true });
    const links = callback.mock.calls[0][0];
    // Should not throw
    links[0].leave();
    Object.defineProperty(terminal, 'element', { value: origElement, writable: true });
  });
});
