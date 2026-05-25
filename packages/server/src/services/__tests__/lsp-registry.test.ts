import { describe, test, expect } from 'bun:test';
import { getInstallInfo } from '../lsp-registry';

// SCSS is served by the same vscode-css-language-server as CSS (selected by the
// languageId the client sends), so it needs its own registry key to get a
// distinct instance + correct languageId. Indented `.sass` isn't supported by
// that server → intentionally no entry (highlight-only).
describe('lsp-registry — SCSS', () => {
  test('scss resolves to the css language server + installable package', () => {
    const e = getInstallInfo('scss');
    expect(e).not.toBeNull();
    expect(e!.command).toBe('vscode-css-language-server');
    expect(e!.args).toEqual(['--stdio']);
    expect(e!.npmPackage).toBe('vscode-langservers-extracted');
  });

  test('scss uses the same server as css (shared package)', () => {
    const css = getInstallInfo('css');
    const scss = getInstallInfo('scss');
    expect(scss!.command).toBe(css!.command);
    expect(scss!.npmPackage).toBe(css!.npmPackage);
  });

  test('indented .sass has no LSP entry (highlight-only)', () => {
    expect(getInstallInfo('sass')).toBeNull();
  });
});
