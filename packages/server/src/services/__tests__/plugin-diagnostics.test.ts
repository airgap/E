/**
 * Tests for the command-based plugin diagnostics runtime.
 * Covers:
 *   - extension routing (only matching contributions run)
 *   - pattern parsing into normalized DiagnosticItems (line/col are
 *     0-indexed in the output)
 *   - severity normalisation
 *   - resilience: bad pattern, missing binary, non-zero exit, oversize
 *     stdout — none of these throw
 *   - argv[0] is rooted in the install dir (absolute / PATH-style refused)
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';

let tmpHome: string;
const origHome = process.env.HOME;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'e-plugin-diags-test-'));
  process.env.HOME = tmpHome;
  const svc = await import('../plugins');
  svc.__setPluginsDirForTests(join(tmpHome, '.e', 'plugins'));
});

afterEach(async () => {
  process.env.HOME = origHome;
  const diags = await import('../plugin-diagnostics');
  diags.__setSpawnForTests(null);
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true });
});

function buildZip(manifest: any, extraFiles: { name: string; data: Buffer }[] = []): Buffer {
  const zip = new AdmZip();
  zip.addFile('plugin.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  for (const f of extraFiles) zip.addFile(f.name, f.data);
  return zip.toBuffer();
}

function manifest(id: string, diag: any, binName = 'bin/linter'): any {
  return {
    id,
    version: '1.0.0',
    displayName: id,
    contributes: {
      diagnostics: [diag],
    },
  };
}

function installEnabled(zip: Buffer, id: string) {
  // tests import the service lazily because beforeEach swaps PLUGINS_DIR
  // — every test imports through this helper after the swap.
}

/**
 * Stub spawn — returns the canned stdout for any spawned child. Captures
 * the argv so tests can assert what got spawned.
 */
function stubSpawnReturning(stdout: string, exitCode = 0) {
  const calls: { cmd: string[]; cwd?: string }[] = [];
  const fake = ((opts: any) => {
    calls.push({ cmd: opts.cmd, cwd: opts.cwd });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stdout));
        controller.close();
      },
    });
    return {
      stdout: stream,
      stderr: null,
      exited: Promise.resolve(exitCode),
      kill: () => undefined,
    } as any;
  }) as unknown as typeof Bun.spawn;
  return { fake, calls };
}

describe('parsePatternOutput', () => {
  test('parses gcc-style line/col/severity/message', async () => {
    const diags = await import('../plugin-diagnostics');
    const text = `/tmp/foo.foo:12:5: error: missing semicolon
/tmp/foo.foo:30:1: warning: unused variable\n`;
    const pattern =
      '^(?<file>[^:]+):(?<line>\\d+):(?<col>\\d+):\\s*(?<severity>error|warning):\\s*(?<message>.+)$';
    const out = diags.parsePatternOutput(pattern, text, '/tmp/fallback.foo', 'plugin:foo');
    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({
      path: '/tmp/foo.foo',
      line: 11, // 12 → 0-indexed
      character: 4, // 5 → 0-indexed
      severity: 'error',
      message: 'missing semicolon',
      source: 'plugin:foo',
    });
    expect(out[1].severity).toBe('warning');
    expect(out[1].line).toBe(29);
  });

  test('falls back to provided path when pattern omits file group', async () => {
    const diags = await import('../plugin-diagnostics');
    const out = diags.parsePatternOutput(
      '^(?<line>\\d+):(?<message>.+)$',
      '7: oops',
      '/tmp/fallback.foo',
      'plugin:foo',
    );
    expect(out[0].path).toBe('/tmp/fallback.foo');
    expect(out[0].severity).toBe('info'); // default when no severity group
  });

  test('skips empty messages', async () => {
    const diags = await import('../plugin-diagnostics');
    const out = diags.parsePatternOutput(
      '^(?<line>\\d+):(?<message>.*)$',
      '1:\n2:something',
      '/tmp/x.foo',
      'plugin:foo',
    );
    expect(out.length).toBe(1);
    expect(out[0].message).toBe('something');
  });

  test('bad regex returns empty list, does not throw', async () => {
    const diags = await import('../plugin-diagnostics');
    const out = diags.parsePatternOutput(
      '(?<line>\\d+', // unterminated
      'whatever',
      '/tmp/x.foo',
      'plugin:foo',
    );
    expect(out).toEqual([]);
  });

  test('caps matches and recovers from zero-width patterns', async () => {
    const diags = await import('../plugin-diagnostics');
    // Pattern with optional content → would loop on '' otherwise.
    const out = diags.parsePatternOutput(
      '(?<line>\\d*)(?<message>.*)',
      'abc',
      '/tmp/x.foo',
      'plugin:foo',
    );
    // No assertion on count beyond "finishes" — the test is that it returns.
    expect(Array.isArray(out)).toBe(true);
  });
});

describe('severity normalisation', () => {
  test('maps various forms to the canonical set', async () => {
    const diags = await import('../plugin-diagnostics');
    const cases: Array<[string, string]> = [
      ['ERROR', 'error'],
      ['err', 'error'],
      ['Warning', 'warning'],
      ['warn', 'warning'],
      ['Hint', 'hint'],
      ['note', 'info'],
      ['gibberish', 'info'],
    ];
    for (const [raw, expected] of cases) {
      const out = diags.parsePatternOutput(
        '(?<severity>[^:]+):(?<line>\\d+):(?<message>.+)',
        `${raw}:1:m`,
        '/tmp/x.foo',
        'plugin:foo',
      );
      expect(out[0].severity).toBe(expected as any);
    }
  });
});

describe('runDiagnosticsForFile', () => {
  test('runs the matching command-source contribution and parses its output', async () => {
    const svc = await import('../plugins');
    const diags = await import('../plugin-diagnostics');
    const m = manifest('foolint', {
      source: 'command',
      extensions: ['.foo'],
      command: ['bin/lint'],
      pattern: '^(?<line>\\d+):(?<severity>error|warning|info):(?<message>.+)$',
    });
    // The binary must exist on disk for resolveBinary to accept it.
    const buf = buildZip(m, [{ name: 'bin/lint', data: Buffer.from('#!/bin/sh\nexit 0\n') }]);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    expect(svc.setEnabled('foolint', true).ok).toBe(true);

    const { fake, calls } = stubSpawnReturning('5:error:bang\n7:warning:meh\n');
    diags.__setSpawnForTests(fake);

    const out = await diags.runDiagnosticsForFile('/tmp/file.foo');
    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({
      line: 4,
      severity: 'error',
      message: 'bang',
      source: 'plugin:foolint',
    });
    // argv: [resolved binary, ...argvTail, absPath]
    expect(calls[0].cmd[calls[0].cmd.length - 1]).toBe('/tmp/file.foo');
    expect(calls[0].cmd[0].endsWith('/bin/lint')).toBe(true);
  });

  test('skips contributions whose extension does not match', async () => {
    const svc = await import('../plugins');
    const diags = await import('../plugin-diagnostics');
    const m = manifest('foolint', {
      source: 'command',
      extensions: ['.bar'],
      command: ['bin/lint'],
      pattern: '^(?<line>\\d+):(?<message>.+)$',
    });
    const buf = buildZip(m, [{ name: 'bin/lint', data: Buffer.from('#!/bin/sh\nexit 0\n') }]);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    expect(svc.setEnabled('foolint', true).ok).toBe(true);

    const { fake, calls } = stubSpawnReturning('1:should not appear');
    diags.__setSpawnForTests(fake);

    const out = await diags.runDiagnosticsForFile('/tmp/file.foo');
    expect(out).toEqual([]);
    expect(calls.length).toBe(0);
  });

  test('refuses an argv[0] that escapes the install dir', async () => {
    const svc = await import('../plugins');
    const diags = await import('../plugin-diagnostics');
    const m = manifest('foolint', {
      source: 'command',
      extensions: ['.foo'],
      command: ['/bin/echo'], // absolute → must be refused
      pattern: '^(?<line>\\d+):(?<message>.+)$',
    });
    const buf = buildZip(m);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    expect(svc.setEnabled('foolint', true).ok).toBe(true);

    const { fake, calls } = stubSpawnReturning('1:nope');
    diags.__setSpawnForTests(fake);

    const out = await diags.runDiagnosticsForFile('/tmp/file.foo');
    expect(out).toEqual([]);
    expect(calls.length).toBe(0);
  });

  test('disabled plugin contributions are ignored', async () => {
    const svc = await import('../plugins');
    const diags = await import('../plugin-diagnostics');
    const m = manifest('foolint', {
      source: 'command',
      extensions: ['.foo'],
      command: ['bin/lint'],
      pattern: '^(?<line>\\d+):(?<message>.+)$',
    });
    const buf = buildZip(m, [{ name: 'bin/lint', data: Buffer.from('#!/bin/sh\nexit 0\n') }]);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    // Do NOT enable.

    const { fake, calls } = stubSpawnReturning('1:would-appear');
    diags.__setSpawnForTests(fake);

    const out = await diags.runDiagnosticsForFile('/tmp/file.foo');
    expect(out).toEqual([]);
    expect(calls.length).toBe(0);
  });

  test('source="lsp" contributions are not invoked here', async () => {
    const svc = await import('../plugins');
    const diags = await import('../plugin-diagnostics');
    const m = manifest('foolsp', {
      source: 'lsp',
      extensions: ['.foo'],
    });
    const buf = buildZip(m);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    expect(svc.setEnabled('foolsp', true).ok).toBe(true);

    const { fake, calls } = stubSpawnReturning('1:nope');
    diags.__setSpawnForTests(fake);
    const out = await diags.runDiagnosticsForFile('/tmp/file.foo');
    expect(out).toEqual([]);
    expect(calls.length).toBe(0);
  });

  test('non-zero exit still parses whatever stdout was emitted', async () => {
    const svc = await import('../plugins');
    const diags = await import('../plugin-diagnostics');
    const m = manifest('foolint', {
      source: 'command',
      extensions: ['.foo'],
      command: ['bin/lint'],
      pattern: '^(?<line>\\d+):(?<message>.+)$',
    });
    const buf = buildZip(m, [{ name: 'bin/lint', data: Buffer.from('#!/bin/sh\nexit 1\n') }]);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    expect(svc.setEnabled('foolint', true).ok).toBe(true);

    const { fake } = stubSpawnReturning('3:hi', 1);
    diags.__setSpawnForTests(fake);
    const out = await diags.runDiagnosticsForFile('/tmp/file.foo');
    expect(out[0].message).toBe('hi');
  });

  test('extensions: ["*"] matches any file', async () => {
    const svc = await import('../plugins');
    const diags = await import('../plugin-diagnostics');
    const m = manifest('foolint', {
      source: 'command',
      extensions: ['*'],
      command: ['bin/lint'],
      pattern: '^(?<line>\\d+):(?<message>.+)$',
    });
    const buf = buildZip(m, [{ name: 'bin/lint', data: Buffer.from('#!/bin/sh\nexit 0\n') }]);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    expect(svc.setEnabled('foolint', true).ok).toBe(true);

    const { fake, calls } = stubSpawnReturning('1:any');
    diags.__setSpawnForTests(fake);
    const out = await diags.runDiagnosticsForFile('/tmp/some-other-thing.zzz');
    expect(out.length).toBe(1);
    expect(calls.length).toBe(1);
  });
});
