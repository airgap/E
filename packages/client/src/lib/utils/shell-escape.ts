/**
 * Shell-escape a file path for safe insertion into a terminal.
 *
 * - Paths with no special characters are returned as-is.
 * - Paths containing spaces, quotes, or other shell-sensitive characters
 *   are single-quoted with internal single quotes escaped.
 */
export function shellEscapePath(filePath: string): string {
  // Characters that are safe without quoting: alphanumeric, /, ., -, _, ~, :, +, @, =, ,
  if (/^[a-zA-Z0-9/.\-_~:+@=,]+$/.test(filePath)) {
    return filePath;
  }

  // Single-quote the path, escaping any internal single quotes
  // Shell idiom: replace ' with '\'' (end quote, escaped quote, start quote)
  const escaped = filePath.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}
