/**
 * Tests for plugin-hovers.ts — the command-based hover runtime.
 *
 * Covers:
 *   - extension routing (only matching contributions run)
 *   - stdout is returned trimmed as markdown
 *   - argv includes <absPath> <line> <character> after the manifest's argv
 *   - argv[0] outside the install dir is refused
 *   - empty stdout → null (filtered out)
 *   - disabled plugins are skipped
 *   - source='lsp' contributions are NOT run here
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';

let tmpHome: string;
const origHome = process.env.HOME;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'e-plugin-hovers-test-'));
  process.env.HOME = tmpHome;
  const svc = await import('../plugins');
  svc.__setPluginsDirForTests(join(tmpHome, '.e', 'plugins'));
});

afterEach(async () => {
  process.env.HOME = origHome;
  const hov = await import('../plugin-hovers');
  hov.__setSpawnForTests(null);
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true });
});

function buildZip(manifest: any, extraFiles: { name: string; data: Buffer }[] = []): Buffer {
  const zip = new AdmZip();
  zip.addFile('plugin.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  for (const f of extraFiles) zip.addFile(f.name, f.data);
  return zip.toBuffer();
}

function manifest(id: string, hover: any): any {
  return {
    id,
    version: '1.0.0',
    displayName: id,
    contributes: {
      hovers: [hover],
    },
  };
}

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

describe('runHoverForFile', () => {
  test('spawns the matching command and returns its trimmed stdout as markdown', async () => {
    const svc = await import('../plugins');
    const hov = await import('../plugin-hovers');
    const m = manifest('foohov', {
      source: 'command',
      extensions: ['.foo'],
      command: ['bin/hov'],
    });
    const buf = buildZip(m, [{ name: 'bin/hov', data: Buffer.from('#!/bin/sh\nexit 0\n') }]);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    expect(svc.setEnabled('foohov', true).ok).toBe(true);

    const { fake, calls } = stubSpawnReturning('## hello\n\nworld\n');
    hov.__setSpawnForTests(fake);

    const out = await hov.runHoverForFile('/tmp/file.foo', 4, 7);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({
      markdown: '## hello\n\nworld',
      source: 'plugin:foohov',
    });
    // argv: [binary, ...argvTail, absPath, line, character]
    const cmd = calls[0].cmd;
    expect(cmd[cmd.length - 3]).toBe('/tmp/file.foo');
    expect(cmd[cmd.length - 2]).toBe('4');
    expect(cmd[cmd.length - 1]).toBe('7');
    expect(cmd[0].endsWith('/bin/hov')).toBe(true);
  });

  test('skips contributions whose extension does not match', async () => {
    const svc = await import('../plugins');
    const hov = await import('../plugin-hovers');
    const m = manifest('foohov', {
      source: 'command',
      extensions: ['.bar'],
      command: ['bin/hov'],
    });
    const buf = buildZip(m, [{ name: 'bin/hov', data: Buffer.from('#!/bin/sh\nexit 0\n') }]);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    expect(svc.setEnabled('foohov', true).ok).toBe(true);

    const { fake, calls } = stubSpawnReturning('should not appear');
    hov.__setSpawnForTests(fake);

    const out = await hov.runHoverForFile('/tmp/file.foo', 0, 0);
    expect(out).toEqual([]);
    expect(calls.length).toBe(0);
  });

  test('refuses an argv[0] that escapes the install dir', async () => {
    const svc = await import('../plugins');
    const hov = await import('../plugin-hovers');
    const m = manifest('foohov', {
      source: 'command',
      extensions: ['.foo'],
      command: ['/bin/echo'], // absolute → refused
    });
    const buf = buildZip(m);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    expect(svc.setEnabled('foohov', true).ok).toBe(true);

    const { fake, calls } = stubSpawnReturning('nope');
    hov.__setSpawnForTests(fake);

    const out = await hov.runHoverForFile('/tmp/file.foo', 0, 0);
    expect(out).toEqual([]);
    expect(calls.length).toBe(0);
  });

  test('empty / whitespace-only stdout is filtered out', async () => {
    const svc = await import('../plugins');
    const hov = await import('../plugin-hovers');
    const m = manifest('foohov', {
      source: 'command',
      extensions: ['.foo'],
      command: ['bin/hov'],
    });
    const buf = buildZip(m, [{ name: 'bin/hov', data: Buffer.from('#!/bin/sh\nexit 0\n') }]);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    expect(svc.setEnabled('foohov', true).ok).toBe(true);

    const { fake } = stubSpawnReturning('   \n  \n');
    hov.__setSpawnForTests(fake);

    const out = await hov.runHoverForFile('/tmp/file.foo', 0, 0);
    expect(out).toEqual([]);
  });

  test('disabled plugins are skipped', async () => {
    const svc = await import('../plugins');
    const hov = await import('../plugin-hovers');
    const m = manifest('foohov', {
      source: 'command',
      extensions: ['.foo'],
      command: ['bin/hov'],
    });
    const buf = buildZip(m, [{ name: 'bin/hov', data: Buffer.from('#!/bin/sh\nexit 0\n') }]);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    // do NOT enable

    const { fake, calls } = stubSpawnReturning('hi');
    hov.__setSpawnForTests(fake);

    const out = await hov.runHoverForFile('/tmp/file.foo', 0, 0);
    expect(out).toEqual([]);
    expect(calls.length).toBe(0);
  });

  test('source="lsp" contributions are not invoked here', async () => {
    const svc = await import('../plugins');
    const hov = await import('../plugin-hovers');
    const m = manifest('foolsphov', {
      source: 'lsp',
      extensions: ['.foo'],
    });
    const buf = buildZip(m);
    expect(svc.installFromZip(buf).errors).toEqual([]);
    expect(svc.setEnabled('foolsphov', true).ok).toBe(true);

    const { fake, calls } = stubSpawnReturning('nope');
    hov.__setSpawnForTests(fake);
    const out = await hov.runHoverForFile('/tmp/file.foo', 0, 0);
    expect(out).toEqual([]);
    expect(calls.length).toBe(0);
  });
});
