import { describe, test, expect } from 'vitest';
import { shellEscapePath } from '../shell-escape';

describe('shellEscapePath', () => {
  test('returns simple alphanumeric path as-is', () => {
    expect(shellEscapePath('/usr/local/bin/node')).toBe('/usr/local/bin/node');
  });

  test('returns path with dots, hyphens, underscores as-is', () => {
    expect(shellEscapePath('/home/user/my-project/foo_bar.ts')).toBe(
      '/home/user/my-project/foo_bar.ts',
    );
  });

  test('returns path with tilde as-is', () => {
    expect(shellEscapePath('~/Documents/file.txt')).toBe('~/Documents/file.txt');
  });

  test('returns path with colons, plus, at, equals, commas as-is', () => {
    expect(shellEscapePath('/path/to/file:42:10')).toBe('/path/to/file:42:10');
    expect(shellEscapePath('/a+b@c=d,e')).toBe('/a+b@c=d,e');
  });

  test('quotes path containing spaces', () => {
    expect(shellEscapePath('/home/user/my project/file.ts')).toBe(
      "'/home/user/my project/file.ts'",
    );
  });

  test('escapes single quotes within the path', () => {
    expect(shellEscapePath("/home/user/it's a file.ts")).toBe("'/home/user/it'\\''s a file.ts'");
  });

  test('quotes path with dollar sign', () => {
    expect(shellEscapePath('/home/$USER/file.ts')).toBe("'/home/$USER/file.ts'");
  });

  test('quotes path with parentheses', () => {
    expect(shellEscapePath('/path/to/(copy)/file.ts')).toBe("'/path/to/(copy)/file.ts'");
  });

  test('quotes path with backticks', () => {
    expect(shellEscapePath('/path/`cmd`/file.ts')).toBe("'/path/`cmd`/file.ts'");
  });

  test('handles empty string', () => {
    // Empty string has no safe chars, so gets quoted
    expect(shellEscapePath('')).toBe("''");
  });
});
