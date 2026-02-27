import { describe, test, expect } from 'vitest';
import { detectMultiPartRequest } from '../task-detector';

describe('detectMultiPartRequest', () => {
  // ── Guard clauses (shouldSkip) ──

  test('returns NO_MATCH for short text (<30 chars)', () => {
    const result = detectMultiPartRequest('Fix the bug');
    expect(result.isMultiPart).toBe(false);
    expect(result.tasks).toEqual([]);
  });

  test('returns NO_MATCH for slash commands', () => {
    const result = detectMultiPartRequest(
      '/help I need to fix the bug and add a feature and refactor the code',
    );
    expect(result.isMultiPart).toBe(false);
  });

  test('returns NO_MATCH for questions', () => {
    const result = detectMultiPartRequest(
      'Can you help me fix the bug and add a feature and refactor the code?',
    );
    expect(result.isMultiPart).toBe(false);
  });

  test('returns NO_MATCH for very long text (>2000 chars)', () => {
    const long = 'Fix the bug. Add a feature. Refactor the code. ' + 'x'.repeat(2000);
    const result = detectMultiPartRequest(long);
    expect(result.isMultiPart).toBe(false);
  });

  // ── Pass 1: Numbered lists ──

  test('detects numbered list with dot format (1. 2. 3.)', () => {
    const result = detectMultiPartRequest(
      'Please do the following:\n1. Fix the authentication bug\n2. Add input validation\n3. Update the tests',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks[0].text).toBe('Fix the authentication bug');
    expect(result.tasks[1].text).toBe('Add input validation');
    expect(result.tasks[2].text).toBe('Update the tests');
  });

  test('detects numbered list with paren format (1) 2) 3))', () => {
    const result = detectMultiPartRequest(
      'Tasks to do:\n1) Fix the authentication bug\n2) Add input validation',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.tasks).toHaveLength(2);
  });

  test('does not detect single numbered item as multi-part', () => {
    const result = detectMultiPartRequest(
      'Here is the task:\n1. Fix the authentication bug in the login form',
    );
    expect(result.isMultiPart).toBe(false);
  });

  // ── Pass 1: Bullet lists ──

  test('detects bullet list with dashes', () => {
    const result = detectMultiPartRequest(
      'Please handle these:\n- Fix the authentication bug\n- Add input validation\n- Update the tests',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks[0].text).toBe('Fix the authentication bug');
  });

  test('detects bullet list with asterisks', () => {
    const result = detectMultiPartRequest(
      'Do these things:\n* Fix the authentication bug\n* Add input validation',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.tasks).toHaveLength(2);
  });

  test('does not detect single bullet as multi-part', () => {
    const result = detectMultiPartRequest(
      'Do this one thing:\n- Fix the authentication bug in the login form',
    );
    expect(result.isMultiPart).toBe(false);
  });

  // ── Pass 2: Imperative verb detection ──

  test('detects imperative fragments joined by ", and"', () => {
    const result = detectMultiPartRequest(
      'Fix the authentication bug, and add input validation to the form',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.confidence).toBe('medium');
    expect(result.tasks).toHaveLength(2);
  });

  test('detects imperative fragments joined by ", then"', () => {
    const result = detectMultiPartRequest(
      'Update the database schema, then migrate the existing data to the new format',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.confidence).toBe('medium');
    expect(result.tasks).toHaveLength(2);
  });

  test('detects imperative fragments joined by ", also"', () => {
    const result = detectMultiPartRequest(
      'Refactor the user service class, also add unit tests for the new methods',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.confidence).toBe('medium');
    expect(result.tasks).toHaveLength(2);
  });

  test('detects imperative fragments separated by period', () => {
    const result = detectMultiPartRequest(
      'Fix the login bug in the auth module. Add rate limiting to the API endpoint.',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.confidence).toBe('medium');
    expect(result.tasks).toHaveLength(2);
  });

  test('detects imperative fragments separated by semicolons', () => {
    const result = detectMultiPartRequest(
      'Fix the login bug in the auth module; add rate limiting to the API endpoint',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.confidence).toBe('medium');
    expect(result.tasks).toHaveLength(2);
  });

  test('strips leading filler words before verb check', () => {
    const result = detectMultiPartRequest(
      'Fix the auth bug, and then add validation to the form inputs',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.tasks).toHaveLength(2);
  });

  test('handles "set up" as two-word verb', () => {
    const result = detectMultiPartRequest(
      'Set up the CI pipeline, and configure the deployment scripts for production',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.tasks).toHaveLength(2);
  });

  test('returns NO_MATCH for single imperative task', () => {
    const result = detectMultiPartRequest('Fix the authentication bug in the login form component');
    expect(result.isMultiPart).toBe(false);
  });

  // ── Code block stripping ──

  test('strips code blocks before analysis to avoid false positives', () => {
    const result = detectMultiPartRequest(
      'Fix this:\n```\n1. item one\n2. item two\n3. item three\n```\nThat code block has a list but is a single task.',
    );
    // After stripping the code block, only "Fix this:" and "That code block..." remain
    // Neither forms a multi-part structure
    expect(result.isMultiPart).toBe(false);
  });

  // ── Task structure ──

  test('tasks have correct index and selected fields', () => {
    const result = detectMultiPartRequest('Do:\n1. First task\n2. Second task\n3. Third task');
    expect(result.tasks[0]).toEqual({ text: 'First task', index: 0, selected: true });
    expect(result.tasks[1]).toEqual({ text: 'Second task', index: 1, selected: true });
    expect(result.tasks[2]).toEqual({ text: 'Third task', index: 2, selected: true });
  });

  // ── Priority: numbered list takes precedence over imperative ──

  test('numbered list (pass 1) takes precedence over imperative (pass 2)', () => {
    const result = detectMultiPartRequest(
      'Fix the bug, and add tests.\n1. Fix the auth bug\n2. Add unit tests',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.confidence).toBe('high'); // numbered = high, not medium
  });

  // ── Additionally conjunction ──

  test('detects ", additionally" conjunction', () => {
    const result = detectMultiPartRequest(
      'Fix the authentication bug, additionally add input validation to the form',
    );
    expect(result.isMultiPart).toBe(true);
    expect(result.confidence).toBe('medium');
    expect(result.tasks).toHaveLength(2);
  });
});
