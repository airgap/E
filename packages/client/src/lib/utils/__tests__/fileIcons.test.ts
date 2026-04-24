import { describe, expect, test } from 'vitest';
import { getFileIcon } from '../fileIcons';

describe('getFileIcon', () => {
  test('directories default to the folder kind', () => {
    const icon = getFileIcon('random-name', true);
    expect(icon.kind).toBe('folder-closed');
  });

  test('open folders get the folder-open kind', () => {
    expect(getFileIcon('src', true, true).kind).toBe('folder-open');
    expect(getFileIcon('src', true, false).kind).toBe('folder-closed');
  });

  test('special folder names get dedicated colors', () => {
    expect(getFileIcon('.git', true).color).toBe('#f05032');
    expect(getFileIcon('node_modules', true).label).toBe('NM');
    expect(getFileIcon('src', true).color).toBe('#60a5fa');
  });

  test('extensions drive color + label', () => {
    expect(getFileIcon('app.ts', false).label).toBe('TS');
    expect(getFileIcon('Button.tsx', false).label).toBe('TSX');
    expect(getFileIcon('thing.rs', false).color).toBe('#f97316');
    expect(getFileIcon('style.css', false).color).toBe('#1572b6');
    expect(getFileIcon('page.svelte', false).color).toBe('#ff3e00');
  });

  test('special filenames override extension lookup', () => {
    expect(getFileIcon('package.json', false).label).toBe('NPM');
    expect(getFileIcon('tsconfig.json', false).label).toBe('TS');
    expect(getFileIcon('Dockerfile', false).label).toBe('DOC');
    expect(getFileIcon('Makefile', false).label).toBe('MK');
  });

  test('dotfiles match by their leading dot segment', () => {
    expect(getFileIcon('.env.local', false).label).toBe('ENV');
    expect(getFileIcon('.gitignore', false).label).toBe('GIT');
  });

  test('unknown files fall back to the default color, no label', () => {
    const icon = getFileIcon('mystery.xyzzy', false);
    expect(icon.kind).toBe('file');
    expect(icon.color).toBe('#9ca3af');
    expect(icon.label).toBeUndefined();
  });

  test('is case-insensitive on special names', () => {
    expect(getFileIcon('README.md', false).label).toBe('MD');
    expect(getFileIcon('DOCKERFILE', false).label).toBe('DOC');
    expect(getFileIcon('Package.Json', false).label).toBe('NPM');
  });
});
