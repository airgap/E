import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  exportAsMarkdown,
  exportAsJSON,
  exportAsAudio,
  downloadExport,
} from '../commentary-export';

// Minimal CommentaryEntry shape used by these functions
function makeEntry(
  overrides: Partial<{
    timestamp: number;
    text: string;
    personality: string;
    workspaceId: string;
  }> = {},
) {
  return {
    timestamp: overrides.timestamp ?? 1700000000000,
    text: overrides.text ?? 'Test commentary text',
    personality: overrides.personality ?? 'sports_caster',
    workspaceId: overrides.workspaceId ?? 'ws-1',
    id: 'entry-1',
    conversationId: 'conv-1',
    type: 'commentary' as const,
  };
}

describe('exportAsMarkdown', () => {
  test('generates markdown with header and entries', () => {
    const entries = [
      makeEntry({ text: 'First comment', personality: 'sports_caster', timestamp: 1700000000000 }),
      makeEntry({ text: 'Second comment', personality: 'sports_caster', timestamp: 1700000060000 }),
    ];

    const md = exportAsMarkdown({
      format: 'markdown',
      entries,
      workspacePath: '/home/user/my-project',
    });

    expect(md).toContain('# Commentary Export');
    expect(md).toContain('**Workspace:** my-project');
    expect(md).toContain('**Personality:** sports_caster');
    expect(md).toContain('**Total Entries:** 2');
    expect(md).toContain('## Commentary Timeline');
    expect(md).toContain('> First comment');
    expect(md).toContain('> Second comment');
  });

  test('throws when no entries after filtering', () => {
    expect(() => exportAsMarkdown({ format: 'markdown', entries: [] })).toThrow(
      'No commentary entries to export',
    );
  });

  test('uses "Unknown Workspace" when workspacePath not provided', () => {
    const md = exportAsMarkdown({
      format: 'markdown',
      entries: [makeEntry()],
    });
    expect(md).toContain('**Workspace:** Unknown Workspace');
  });

  test('filters entries by startTime and endTime', () => {
    const entries = [
      makeEntry({ text: 'Before', timestamp: 1000 }),
      makeEntry({ text: 'During', timestamp: 2000 }),
      makeEntry({ text: 'After', timestamp: 3000 }),
    ];

    const md = exportAsMarkdown({
      format: 'markdown',
      entries,
      startTime: 1500,
      endTime: 2500,
    });

    expect(md).toContain('> During');
    expect(md).not.toContain('> Before');
    expect(md).not.toContain('> After');
  });

  test('detects primary personality from entry frequency', () => {
    const entries = [
      makeEntry({ personality: 'wizard' }),
      makeEntry({ personality: 'sports_caster', timestamp: 1700000001000 }),
      makeEntry({ personality: 'sports_caster', timestamp: 1700000002000 }),
    ];

    const md = exportAsMarkdown({ format: 'markdown', entries });
    expect(md).toContain('**Personality:** sports_caster');
  });

  test('capitalizes personality name in entry headers', () => {
    const md = exportAsMarkdown({
      format: 'markdown',
      entries: [makeEntry({ personality: 'sports_caster' })],
    });
    expect(md).toContain('**Personality:** Sports Caster');
  });
});

describe('exportAsJSON', () => {
  test('generates valid JSON with metadata and entries', () => {
    const entries = [makeEntry({ text: 'Hello world' })];
    const json = exportAsJSON({ format: 'json', entries, workspacePath: '/home/user/proj' });
    const parsed = JSON.parse(json);

    expect(parsed.metadata).toBeDefined();
    expect(parsed.metadata.workspaceName).toBe('proj');
    expect(parsed.metadata.totalEntries).toBe(1);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].text).toBe('Hello world');
    expect(parsed.entries[0].timestampISO).toBeDefined();
  });

  test('throws when no entries', () => {
    expect(() => exportAsJSON({ format: 'json', entries: [] })).toThrow(
      'No commentary entries to export',
    );
  });

  test('includes workspaceId in entry output', () => {
    const entries = [makeEntry({ workspaceId: 'ws-42' })];
    const parsed = JSON.parse(exportAsJSON({ format: 'json', entries }));
    expect(parsed.entries[0].workspaceId).toBe('ws-42');
  });
});

describe('exportAsAudio', () => {
  beforeEach(() => {
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), getVoices: vi.fn(() => []) });
  });

  test('generates text blob transcript', async () => {
    const entries = [
      makeEntry({ text: 'First line', timestamp: 1700000000000 }),
      makeEntry({ text: 'Second line', timestamp: 1700000060000 }),
    ];

    const blob = await exportAsAudio({
      format: 'audio',
      entries,
      workspacePath: '/home/user/proj',
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/plain');

    const text = await blob.text();
    expect(text).toContain('Commentary Export');
    expect(text).toContain('[1]');
    expect(text).toContain('First line');
    expect(text).toContain('[2]');
    expect(text).toContain('Second line');
  });

  test('throws when no entries', async () => {
    await expect(exportAsAudio({ format: 'audio', entries: [] })).rejects.toThrow(
      'No commentary entries to export',
    );
  });

  // Note: testing 'speechSynthesis not in window' is not feasible in happy-dom
  // because the property can't be fully removed from the Window prototype
});

describe('downloadExport', () => {
  let mockCreateObjectURL: ReturnType<typeof vi.fn>;
  let mockRevokeObjectURL: ReturnType<typeof vi.fn>;
  let mockClick: ReturnType<typeof vi.fn>;
  let appendedElement: HTMLAnchorElement | null;

  beforeEach(() => {
    mockCreateObjectURL = vi.fn(() => 'blob:test-url');
    mockRevokeObjectURL = vi.fn();
    mockClick = vi.fn();
    appendedElement = null;

    vi.stubGlobal('URL', {
      createObjectURL: mockCreateObjectURL,
      revokeObjectURL: mockRevokeObjectURL,
    });

    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: mockClick,
    } as unknown as HTMLAnchorElement);

    vi.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      appendedElement = el as HTMLAnchorElement;
      return el;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((el) => el);
  });

  test('downloads markdown file with correct name and type', () => {
    downloadExport('# Hello', 'markdown');

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });

  test('downloads JSON file', () => {
    downloadExport('{"data": true}', 'json');
    expect(mockClick).toHaveBeenCalled();
  });

  test('downloads audio file from Blob', () => {
    const blob = new Blob(['audio text'], { type: 'text/plain' });
    downloadExport(blob, 'audio');
    expect(mockClick).toHaveBeenCalled();
  });

  test('throws on unsupported format', () => {
    expect(() => downloadExport('data', 'csv' as any)).toThrow('Unsupported export format');
  });
});
