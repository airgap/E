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

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'e-plugins-test-'));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  process.env.HOME = origHome;
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true });
});

// Bun caches modules — but the plugins service reads HOME each call via
// homedir(), so a per-test HOME swap propagates correctly without
// needing to bust the module cache.
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
  test('lists "not yet runtime-supported" for future contribution kinds', async () => {
    const svc = await loadService();
    const buf = buildZip(
      validManifest({
        contributes: {
          lsp: [{ language: 'foo', extensions: ['.foo'], command: ['./bin/foo-lsp'] }],
          syntaxHighlighters: [{ language: 'foo', extensions: ['.foo'], tmGrammar: 'g.json' }],
        },
      }),
    );
    expect(svc.installFromZip(buf).errors).toEqual([]);
    const warns = svc.listPlugins()[0].warnings;
    expect(warns.some((w) => /lsp/.test(w))).toBe(true);
    expect(warns.some((w) => /syntaxHighlighters/.test(w))).toBe(true);
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
