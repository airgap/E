import { describe, test, expect } from 'vitest';
import { BUILTIN_PALETTE } from '../pui-palette';
import { parsePuiMarkup } from '../pui-ast';

// A palette item that doesn't parse would insert broken markup and break the
// preview the moment it's clicked, so pin that every built-in snippet is valid.

describe('BUILTIN_PALETTE', () => {
  const items = BUILTIN_PALETTE.flatMap((g) => g.items);

  test('every snippet parses to exactly one root node', () => {
    for (const item of items) {
      const { tree, error } = parsePuiMarkup(item.snippet);
      expect(error, `${item.label} should parse`).toBeUndefined();
      expect(tree, `${item.label} should yield one root node`).toHaveLength(1);
    }
  });

  test('labels are unique', () => {
    const labels = items.map((i) => i.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
