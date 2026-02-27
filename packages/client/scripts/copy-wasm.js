/**
 * Copies tree-sitter WASM files from node_modules into the static directory
 * so they're served at /tree-sitter/*.wasm at runtime.
 *
 * Run automatically before `vite build`, or manually with `bun run copy-wasm`.
 */
import { copyFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dest = resolve(__dirname, '../static/tree-sitter');

mkdirSync(dest, { recursive: true });

function copy(pkg, file, destName) {
  try {
    const pkgDir = dirname(require.resolve(`${pkg}/package.json`));
    copyFileSync(resolve(pkgDir, file), resolve(dest, destName ?? file));
    console.log(`  ✓ ${destName ?? file}`);
  } catch (e) {
    console.warn(`  ✗ ${pkg}/${file}: ${e.message}`);
  }
}

console.log('Copying tree-sitter WASM files →', dest);

// Core runtime — resolve via the wasm subpath export instead of package.json
try {
  const wasmPath = require.resolve('web-tree-sitter/web-tree-sitter.wasm');
  copyFileSync(wasmPath, resolve(dest, 'web-tree-sitter.wasm'));
  console.log('  ✓ web-tree-sitter.wasm');
} catch (e) {
  console.warn('  ✗ web-tree-sitter.wasm:', e.message);
}

// Language grammars
copy('tree-sitter-javascript', 'tree-sitter-javascript.wasm');
copy('tree-sitter-typescript', 'tree-sitter-typescript.wasm');
copy('tree-sitter-typescript', 'tree-sitter-tsx.wasm');
copy('tree-sitter-python', 'tree-sitter-python.wasm');
copy('tree-sitter-rust', 'tree-sitter-rust.wasm');
copy('tree-sitter-go', 'tree-sitter-go.wasm');
copy('tree-sitter-html', 'tree-sitter-html.wasm');
copy('tree-sitter-css', 'tree-sitter-css.wasm');
copy('tree-sitter-json', 'tree-sitter-json.wasm');
