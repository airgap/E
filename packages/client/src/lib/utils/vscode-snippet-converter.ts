/**
 * Converts VS Code snippet JSON format to CodeMirror-compatible snippets.
 *
 * VS Code format:
 * {
 *   "For Loop": {
 *     "prefix": ["for", "forloop"],
 *     "body": ["for (let ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {", "\t$0", "}"],
 *     "description": "For loop"
 *   }
 * }
 */

export interface VsCodeSnippet {
  prefix: string | string[];
  body: string | string[];
  description?: string;
}

export interface ConvertedSnippet {
  prefix: string;
  body: string;
  description: string;
}

/**
 * Convert `$0` (VS Code final cursor) to `${}` (CodeMirror final cursor).
 * Strip `$TM_*` template variables.
 */
function convertBody(body: string | string[]): string {
  let text = Array.isArray(body) ? body.join('\n') : body;

  // Replace $0 with ${} (CM6 final cursor position)
  text = text.replace(/\$0/g, '${}');

  // Strip $TM_* variables (e.g. $TM_FILENAME, ${TM_FILENAME})
  text = text.replace(/\$TM_\w+/g, '');
  text = text.replace(/\$\{TM_\w+(?::[^}]*)?\}/g, '');

  return text;
}

/**
 * Convert a VS Code snippets JSON object to an array of CodeMirror-compatible snippets.
 * Each prefix in a multi-prefix snippet emits a separate entry.
 */
export function convertVsCodeSnippets(json: Record<string, VsCodeSnippet>): ConvertedSnippet[] {
  const result: ConvertedSnippet[] = [];

  for (const [name, snippet] of Object.entries(json)) {
    if (!snippet.prefix || !snippet.body) continue;

    const body = convertBody(snippet.body);
    const description = snippet.description || name;
    const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];

    for (const prefix of prefixes) {
      result.push({ prefix, body, description });
    }
  }

  return result;
}
