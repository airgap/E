import type { StoryPriority } from '@e/shared';

export interface StoryAddAction {
  type: 'add';
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: StoryPriority;
}

export interface StoryEditAction {
  type: 'edit';
  storyId: string;
  title?: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: StoryPriority;
}

export interface StoryRemoveAction {
  type: 'remove';
  storyId: string;
  reason: string;
}

export type StoryAction = StoryAddAction | StoryEditAction | StoryRemoveAction;

const VALID_PRIORITIES: StoryPriority[] = ['critical', 'high', 'medium', 'low'];

function parsePriority(val: string): StoryPriority {
  const trimmed = val.trim().toLowerCase() as StoryPriority;
  return VALID_PRIORITIES.includes(trimmed) ? trimmed : 'medium';
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let currentKey = '';
  let currentLines: string[] = [];

  for (const line of body.split('\n')) {
    const match = line.match(/^(\w+):\s*(.*)/);
    if (match && match[1] !== '-') {
      // Save previous field
      if (currentKey) {
        fields[currentKey] = currentLines.join('\n').trim();
      }
      currentKey = match[1].toLowerCase();
      currentLines = [match[2]];
    } else {
      currentLines.push(line);
    }
  }
  if (currentKey) {
    fields[currentKey] = currentLines.join('\n').trim();
  }
  return fields;
}

function parseCriteria(fields: Record<string, string>): string[] {
  const raw = fields['criteria'] || '';
  return raw
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Parse structured story action blocks from Claude's response text.
 * Returns an array of actions found; the surrounding text is preserved
 * by the caller (we only extract the structured blocks).
 */
export function parseStoryActions(text: string): StoryAction[] {
  const actions: StoryAction[] = [];

  // Parse <story-add>...</story-add>
  const addRegex = /<story-add>([\s\S]*?)<\/story-add>/g;
  let match: RegExpExecArray | null;
  while ((match = addRegex.exec(text)) !== null) {
    const fields = parseFields(match[1]);
    if (fields['title']) {
      actions.push({
        type: 'add',
        title: fields['title'],
        description: fields['description'] || '',
        acceptanceCriteria: parseCriteria(fields),
        priority: parsePriority(fields['priority'] || 'medium'),
      });
    }
  }

  // Parse <story-edit id="...">...</story-edit>
  const editRegex = /<story-edit\s+id="([^"]+)">([\s\S]*?)<\/story-edit>/g;
  while ((match = editRegex.exec(text)) !== null) {
    const storyId = match[1];
    const fields = parseFields(match[2]);
    const action: StoryEditAction = { type: 'edit', storyId };
    if (fields['title']) action.title = fields['title'];
    if (fields['description']) action.description = fields['description'];
    const criteria = parseCriteria(fields);
    if (criteria.length > 0) action.acceptanceCriteria = criteria;
    if (fields['priority']) action.priority = parsePriority(fields['priority']);
    actions.push(action);
  }

  // Parse <story-remove id="...">...</story-remove>
  const removeRegex = /<story-remove\s+id="([^"]+)">([\s\S]*?)<\/story-remove>/g;
  while ((match = removeRegex.exec(text)) !== null) {
    const fields = parseFields(match[2]);
    actions.push({
      type: 'remove',
      storyId: match[1],
      reason: fields['reason'] || 'No reason provided',
    });
  }

  return actions;
}

/**
 * Check if a text block contains any story action blocks.
 */
export function hasStoryActions(text: string): boolean {
  return /<story-(add|edit|remove)[\s>]/.test(text);
}
