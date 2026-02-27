import { describe, test, expect } from 'vitest';
import { parseStoryActions, hasStoryActions } from '../story-parser';

describe('parseStoryActions', () => {
  test('returns empty array for text with no story blocks', () => {
    expect(parseStoryActions('Just some plain text.')).toEqual([]);
  });

  test('returns empty array for empty string', () => {
    expect(parseStoryActions('')).toEqual([]);
  });

  // ── story-add ──────────────────────────────────────────────────

  test('parses a single story-add block', () => {
    const text = `
Here is a story:
<story-add>
title: Build login page
description: Create a login page with email and password fields
criteria:
- User can enter email
- User can enter password
priority: high
</story-add>
    `;
    const actions = parseStoryActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      type: 'add',
      title: 'Build login page',
      description: 'Create a login page with email and password fields',
      acceptanceCriteria: ['User can enter email', 'User can enter password'],
      priority: 'high',
    });
  });

  test('parses story-add with missing priority, defaults to medium', () => {
    const text = `
<story-add>
title: Some feature
description: A description
criteria:
- Criterion one
</story-add>
    `;
    const actions = parseStoryActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('add');
    if (actions[0].type === 'add') {
      expect(actions[0].priority).toBe('medium');
    }
  });

  test('parses story-add with invalid priority, defaults to medium', () => {
    const text = `
<story-add>
title: Feature X
description: Desc
criteria:
- Done
priority: urgent
</story-add>
    `;
    const actions = parseStoryActions(text);
    expect(actions).toHaveLength(1);
    if (actions[0].type === 'add') {
      expect(actions[0].priority).toBe('medium');
    }
  });

  test('parses story-add with empty description and criteria', () => {
    const text = `
<story-add>
title: Minimal story
</story-add>
    `;
    const actions = parseStoryActions(text);
    expect(actions).toHaveLength(1);
    if (actions[0].type === 'add') {
      expect(actions[0].description).toBe('');
      expect(actions[0].acceptanceCriteria).toEqual([]);
    }
  });

  test('skips story-add block with no title', () => {
    const text = `
<story-add>
description: No title here
priority: low
</story-add>
    `;
    const actions = parseStoryActions(text);
    expect(actions).toHaveLength(0);
  });

  test('parses multiple story-add blocks', () => {
    const text = `
<story-add>
title: First
description: First desc
criteria:
- A
priority: high
</story-add>

<story-add>
title: Second
description: Second desc
criteria:
- B
priority: low
</story-add>
    `;
    const actions = parseStoryActions(text);
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe('add');
    expect(actions[1].type).toBe('add');
    if (actions[0].type === 'add' && actions[1].type === 'add') {
      expect(actions[0].title).toBe('First');
      expect(actions[1].title).toBe('Second');
    }
  });

  test('parses all valid priority values', () => {
    for (const p of ['critical', 'high', 'medium', 'low']) {
      const text = `
<story-add>
title: Story ${p}
description: test
priority: ${p}
</story-add>
      `;
      const actions = parseStoryActions(text);
      expect(actions).toHaveLength(1);
      if (actions[0].type === 'add') {
        expect(actions[0].priority).toBe(p);
      }
    }
  });

  test('parses criteria with * bullet markers', () => {
    const text = `
<story-add>
title: Bullets
description: test
criteria:
* First item
* Second item
</story-add>
    `;
    const actions = parseStoryActions(text);
    if (actions[0].type === 'add') {
      expect(actions[0].acceptanceCriteria).toEqual(['First item', 'Second item']);
    }
  });

  // ── story-edit ─────────────────────────────────────────────────

  test('parses a story-edit block with all fields', () => {
    const text = `
<story-edit id="story-123">
title: Updated title
description: Updated description
criteria:
- New criterion
priority: critical
</story-edit>
    `;
    const actions = parseStoryActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      type: 'edit',
      storyId: 'story-123',
      title: 'Updated title',
      description: 'Updated description',
      acceptanceCriteria: ['New criterion'],
      priority: 'critical',
    });
  });

  test('parses a story-edit block with partial fields', () => {
    const text = `
<story-edit id="abc-456">
title: Only title updated
</story-edit>
    `;
    const actions = parseStoryActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('edit');
    if (actions[0].type === 'edit') {
      expect(actions[0].storyId).toBe('abc-456');
      expect(actions[0].title).toBe('Only title updated');
      expect(actions[0].description).toBeUndefined();
      expect(actions[0].acceptanceCriteria).toBeUndefined();
      expect(actions[0].priority).toBeUndefined();
    }
  });

  // ── story-remove ───────────────────────────────────────────────

  test('parses a story-remove block', () => {
    const text = `
<story-remove id="story-789">
reason: No longer needed after requirements change
</story-remove>
    `;
    const actions = parseStoryActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      type: 'remove',
      storyId: 'story-789',
      reason: 'No longer needed after requirements change',
    });
  });

  test('parses story-remove with no reason, defaults to fallback', () => {
    const text = `
<story-remove id="story-000">
</story-remove>
    `;
    const actions = parseStoryActions(text);
    expect(actions).toHaveLength(1);
    if (actions[0].type === 'remove') {
      expect(actions[0].reason).toBe('No reason provided');
    }
  });

  // ── mixed actions ──────────────────────────────────────────────

  test('parses mixed add, edit, and remove actions in one text', () => {
    const text = `
Here is the plan:

<story-add>
title: New feature
description: Something new
criteria:
- Works correctly
priority: high
</story-add>

We should also update this one:

<story-edit id="existing-1">
title: Revised title
priority: low
</story-edit>

And remove this:

<story-remove id="old-2">
reason: Duplicate of existing-1
</story-remove>
    `;
    const actions = parseStoryActions(text);
    expect(actions).toHaveLength(3);
    expect(actions[0].type).toBe('add');
    expect(actions[1].type).toBe('edit');
    expect(actions[2].type).toBe('remove');
  });

  // ── priority parsing edge cases ────────────────────────────────

  test('handles priority with extra whitespace and mixed case', () => {
    const text = `
<story-add>
title: Casing test
description: test
priority:   HIGH
</story-add>
    `;
    const actions = parseStoryActions(text);
    if (actions[0].type === 'add') {
      expect(actions[0].priority).toBe('high');
    }
  });

  // ── multiline description ──────────────────────────────────────

  test('handles multiline description', () => {
    const text = `
<story-add>
title: Multiline desc
description: Line one
  continues here
  and more
criteria:
- Done
priority: medium
</story-add>
    `;
    const actions = parseStoryActions(text);
    if (actions[0].type === 'add') {
      expect(actions[0].description).toContain('Line one');
      expect(actions[0].description).toContain('continues here');
    }
  });
});

describe('hasStoryActions', () => {
  test('returns true when text contains story-add', () => {
    expect(hasStoryActions('Some text <story-add>\ncontent\n</story-add>')).toBe(true);
  });

  test('returns true when text contains story-edit', () => {
    expect(hasStoryActions('<story-edit id="x">stuff</story-edit>')).toBe(true);
  });

  test('returns true when text contains story-remove', () => {
    expect(hasStoryActions('<story-remove id="y">reason</story-remove>')).toBe(true);
  });

  test('returns false for plain text', () => {
    expect(hasStoryActions('Nothing here')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(hasStoryActions('')).toBe(false);
  });

  test('returns false for partial tag names', () => {
    expect(hasStoryActions('<story-update>stuff</story-update>')).toBe(false);
  });
});
