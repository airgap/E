/**
 * Plugin service tests. Covers:
 *   - manifest validation accepts the v1 schema; rejects bad ids / kinds
 *   - extraction is path-traversal-safe (../, absolute paths, symlinks
 *     refused before any byte hits disk)
 *   - install / list / uninstall round-trips
 *   - enable / disable persists across re-install
 *   - runtime warnings list "future" contribution kinds
 *
 * Tests redirect HOME to a tmp dir so we don't write into the user's real
 * ~/.e/plugins. They write+read real files but cleanly tear down.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';

let tmpHome: string;
const origHome = process.env.HOME;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'e-plugins-test-'));
  process.env.HOME = tmpHome;
  // Bun's homedir() ignores $HOME (reads /etc/passwd directly), so we
  // ALSO route the plugins service explicitly at the tmp dir via the
  // dedicated test seam. Without this the tests silently write into
  // the real ~/.e/plugins.
  const svc = await import('../plugins');
  const reg = await import('../plugin-registry');
  svc.__setPluginsDirForTests(join(tmpHome, '.e', 'plugins'));
  reg.__setPluginsDirForTests(join(tmpHome, '.e', 'plugins'));
  // Clear plugin LSP overrides that may have leaked from prior tests.
  const lspReg = await import('../lsp-registry');
  // Best-effort: unregister all plugin ids the suite uses.
  for (const id of ['my-plugin', 'foo']) lspReg.unregisterPluginLsps(id);
});

afterEach(() => {
  process.env.HOME = origHome;
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true });
});

async function loadService() {
  return await import('../plugins');
}

function buildZip(
  manifest: Record<string, unknown> | null,
  extra: Array<{ name: string; data: Buffer; isSymlink?: boolean; absolute?: boolean }> = [],
): Buffer {
  const zip = new AdmZip();
  if (manifest !== null) {
    zip.addFile('plugin.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  }
  for (const e of extra) {
    // adm-zip's addFile sanitises names at insert time — strips leading
    // '/' and '../' before storing. To exercise our defence we add a
    // placeholder name, then mutate the entry's name AFTER the fact.
    // The mutation survives toBuffer() round-trip.
    zip.addFile('__placeholder__', e.data);
    const ent = zip.getEntries()[zip.getEntries().length - 1];
    ent.entryName = e.name;
    // adm-zip stores attr as (mode << 16); 0o120000 == symlink in unix mode.
    if (e.isSymlink) {
      ent.attr = (0o120000 << 16) >>> 0;
    }
  }
  return zip.toBuffer();
}

const validManifest = (overrides: Record<string, unknown> = {}) => ({
  id: 'my-plugin',
  version: '1.0.0',
  displayName: 'My Plugin',
  ...overrides,
});

describe('installFromZip — manifest validation', () => {
  test('accepts a minimal valid manifest', async () => {
    const svc = await loadService();
    const buf = buildZip(validManifest(), [{ name: 'panel.html', data: Buffer.from('<p>hi</p>') }]);
    const res = svc.installFromZip(buf);
    expect(res.errors).toEqual([]);
    expect(res.plugin?.manifest.id).toBe('my-plugin');
  });

  test('rejects when plugin.json is missing', async () => {
    const svc = await loadService();
    const zip = new AdmZip();
    zip.addFile('panel.html', Buffer.from('<p>hi</p>'));
    const res = svc.installFromZip(zip.toBuffer());
    expect(res.errors[0]).toMatch(/missing plugin.json/);
  });

  test('rejects bad ids', async () => {
    const svc = await loadService();
    const buf = buildZip(validManifest({ id: 'Bad ID' }));
    const res = svc.installFromZip(buf);
    expect(res.errors[0]).toMatch(/manifest\.id/);
  });

  test('rejects sidePanes contribution with .. in src', async () => {
    const svc = await loadService();
    const buf = buildZip(
      validManifest({
        contributes: {
          sidePanes: [
            {
              id: 'pane',
              label: 'Pane',
              icon: 'M0 0 L1 1',
              kind: 'iframe',
              src: '../etc/passwd',
            },
          ],
        },
      }),
    );
    const res = svc.installFromZip(buf);
    expect(res.errors.some((e) => /\.\./.test(e))).toBe(true);
  });
});

describe('installFromZip — extraction safety', () => {
  test('refuses entries with "../" in the path before writing anything', async () => {
    const svc = await loadService();
    const buf = buildZip(validManifest(), [{ name: '../outside.txt', data: Buffer.from('boom') }]);
    const res = svc.installFromZip(buf);
    expect(res.errors[0]).toMatch(/extraction failed|escapes/);
    // Confirm nothing was left behind in the plugin dir.
    expect(existsSync(join(tmpHome, '.e', 'plugins', 'my-plugin'))).toBe(false);
  });

  test('refuses absolute-path entries', async () => {
    const svc = await loadService();
    const buf = buildZip(validManifest(), [{ name: '/etc/passwd', data: Buffer.from('boom') }]);
    const res = svc.installFromZip(buf);
    expect(res.errors[0]).toMatch(/extraction failed|absolute/);
  });

  test('refuses symlink entries', async () => {
    const svc = await loadService();
    const buf = buildZip(validManifest(), [
      { name: 'link', data: Buffer.from('/etc/passwd'), isSymlink: true },
    ]);
    const res = svc.installFromZip(buf);
    expect(res.errors[0]).toMatch(/symlink/);
  });
});

describe('lifecycle: install / list / uninstall / enable / disable', () => {
  test('list returns [] before any install', async () => {
    const svc = await loadService();
    expect(svc.listPlugins()).toEqual([]);
  });

  test('install, then list, then uninstall', async () => {
    const svc = await loadService();
    const buf = buildZip(validManifest(), [
      { name: 'panel.html', data: Buffer.from('<p>hello</p>') },
    ]);
    expect(svc.installFromZip(buf).errors).toEqual([]);

    const list1 = svc.listPlugins();
    expect(list1).toHaveLength(1);
    expect(list1[0].manifest.id).toBe('my-plugin');
    expect(list1[0].enabled).toBe(false); // installed disabled by default

    const un = svc.uninstallPlugin('my-plugin');
    expect(un.ok).toBe(true);
    expect(svc.listPlugins()).toEqual([]);
  });

  test('enable / disable toggles state', async () => {
    const svc = await loadService();
    svc.installFromZip(buildZip(validManifest()));
    expect(svc.listPlugins()[0].enabled).toBe(false);
    expect(svc.setEnabled('my-plugin', true).ok).toBe(true);
    expect(svc.listPlugins()[0].enabled).toBe(true);
    expect(svc.setEnabled('my-plugin', false).ok).toBe(true);
    expect(svc.listPlugins()[0].enabled).toBe(false);
  });

  test('enable state persists across re-install', async () => {
    const svc = await loadService();
    svc.installFromZip(buildZip(validManifest({ version: '1.0.0' })));
    svc.setEnabled('my-plugin', true);
    // Re-install (different version) — should keep enabled.
    svc.installFromZip(buildZip(validManifest({ version: '1.1.0' })));
    expect(svc.listPlugins()[0].enabled).toBe(true);
    expect(svc.listPlugins()[0].manifest.version).toBe('1.1.0');
  });

  test('uninstall removes state along with the dir', async () => {
    const svc = await loadService();
    svc.installFromZip(buildZip(validManifest()));
    svc.setEnabled('my-plugin', true);
    svc.uninstallPlugin('my-plugin');
    // Re-install — should NOT come back enabled, because the prior state
    // was cleaned when we uninstalled.
    svc.installFromZip(buildZip(validManifest()));
    expect(svc.listPlugins()[0].enabled).toBe(false);
  });
});

describe('runtime warnings', () => {
  test('lists "not yet runtime-supported" for kinds without a runtime', async () => {
    const svc = await loadService();
    const buf = buildZip(
      validManifest({
        contributes: {
          // lsp IS wired now — no warning expected.
          lsp: [{ language: 'foo', extensions: ['.foo'], command: ['./bin/foo-lsp'] }],
          // The rest stay unsupported until their runtimes land.
          syntaxHighlighters: [{ language: 'foo', extensions: ['.foo'], tmGrammar: 'g.json' }],
          primaryPanes: [{ id: 'p', label: 'P', icon: 'M0 0', kind: 'iframe', src: 'p.html' }],
        },
      }),
    );
    expect(svc.installFromZip(buf).errors).toEqual([]);
    const warns = svc.listPlugins()[0].warnings;
    expect(warns.some((w) => /lsp/.test(w))).toBe(false); // wired now
    expect(warns.some((w) => /syntaxHighlighters/.test(w))).toBe(true);
    expect(warns.some((w) => /primaryPanes/.test(w))).toBe(true);
  });
});

describe('lsp activation', () => {
  test('enabling a plugin registers its lsp; disabling unregisters', async () => {
    const svc = await loadService();
    const reg = await import('../lsp-registry');
    // Need a binary file that actually exists in the plugin install dir
    // (activatePluginLsps refuses to register missing binaries).
    const buf = buildZip(
      validManifest({
        contributes: {
          lsp: [{ language: 'foolang', extensions: ['.foo'], command: ['bin/foo-lsp', '--stdio'] }],
        },
      }),
      [{ name: 'bin/foo-lsp', data: Buffer.from('#!/bin/sh\nexit 0\n') }],
    );
    expect(svc.installFromZip(buf).errors).toEqual([]);
    // Not enabled yet — getLspCommand for foolang returns null.
    expect(reg.getLspCommand('foolang')).toBeNull();

    svc.setEnabled('my-plugin', true);
    const cmd = reg.getLspCommand('foolang');
    expect(cmd).not.toBeNull();
    expect(cmd!.command.endsWith('bin/foo-lsp')).toBe(true);
    expect(cmd!.args).toEqual(['--stdio']);
    // Extension mapping is also populated.
    expect(reg.pluginLanguageForExtension('.foo')).toBe('foolang');

    svc.setEnabled('my-plugin', false);
    expect(reg.getLspCommand('foolang')).toBeNull();
    expect(reg.pluginLanguageForExtension('.foo')).toBeNull();
  });

  test('install re-extraction with binary path change preserves enable + re-activates', async () => {
    const svc = await loadService();
    const reg = await import('../lsp-registry');
    // Initial: binary at bin/old-path
    svc.installFromZip(
      buildZip(
        validManifest({
          contributes: {
            lsp: [{ language: 'foolang', extensions: ['.foo'], command: ['bin/old-path'] }],
          },
        }),
        [{ name: 'bin/old-path', data: Buffer.from('#!/bin/sh\n') }],
      ),
    );
    svc.setEnabled('my-plugin', true);
    const before = reg.getLspCommand('foolang');
    expect(before!.command.endsWith('bin/old-path')).toBe(true);

    // Re-install with binary at a different relative path.
    svc.installFromZip(
      buildZip(
        validManifest({
          contributes: {
            lsp: [{ language: 'foolang', extensions: ['.foo'], command: ['bin/new-path'] }],
          },
        }),
        [{ name: 'bin/new-path', data: Buffer.from('#!/bin/sh\n') }],
      ),
    );
    const after = reg.getLspCommand('foolang');
    expect(after).not.toBeNull();
    expect(after!.command.endsWith('bin/new-path')).toBe(true);
  });

  test('uninstall tears down lsp registration', async () => {
    const svc = await loadService();
    const reg = await import('../lsp-registry');
    svc.installFromZip(
      buildZip(
        validManifest({
          contributes: {
            lsp: [{ language: 'foolang', extensions: ['.foo'], command: ['bin/foo-lsp'] }],
          },
        }),
        [{ name: 'bin/foo-lsp', data: Buffer.from('#!/bin/sh\n') }],
      ),
    );
    svc.setEnabled('my-plugin', true);
    expect(reg.getLspCommand('foolang')).not.toBeNull();
    svc.uninstallPlugin('my-plugin');
    expect(reg.getLspCommand('foolang')).toBeNull();
  });
});

describe('pluginAssetPath — path traversal defence', () => {
  test('resolves a valid relative path inside the plugin dir', async () => {
    const svc = await loadService();
    // Install first so the dir exists.
    svc.installFromZip(
      buildZip(validManifest(), [{ name: 'panel.html', data: Buffer.from('<p>hi</p>') }]),
    );
    const ok = svc.pluginAssetPath('my-plugin', 'panel.html');
    expect(ok).not.toBeNull();
    expect(ok!.endsWith('panel.html')).toBe(true);
  });

  test('rejects ../ traversal', async () => {
    const svc = await loadService();
    expect(svc.pluginAssetPath('my-plugin', '../../etc/passwd')).toBeNull();
  });

  test('rejects an invalid plugin id', async () => {
    const svc = await loadService();
    expect(svc.pluginAssetPath('Bad-ID', 'x')).toBeNull();
  });
});
