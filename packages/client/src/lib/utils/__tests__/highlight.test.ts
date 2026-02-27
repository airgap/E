import { describe, test, expect } from 'vitest';
import { langFromPath, escapeHtml, highlightLine, highlightLines } from '../highlight';

describe('langFromPath', () => {
  test('returns null for path with no extension', () => {
    expect(langFromPath('README')).toBeNull();
  });

  test('maps .ts to typescript', () => {
    expect(langFromPath('src/app.ts')).toBe('typescript');
  });

  test('maps .tsx to tsx', () => {
    expect(langFromPath('components/Button.tsx')).toBe('tsx');
  });

  test('maps .js to javascript', () => {
    expect(langFromPath('index.js')).toBe('javascript');
  });

  test('maps .jsx to jsx', () => {
    expect(langFromPath('App.jsx')).toBe('jsx');
  });

  test('maps .mjs to javascript', () => {
    expect(langFromPath('config.mjs')).toBe('javascript');
  });

  test('maps .cjs to javascript', () => {
    expect(langFromPath('config.cjs')).toBe('javascript');
  });

  test('maps .py to python', () => {
    expect(langFromPath('script.py')).toBe('python');
  });

  test('maps .rs to rust', () => {
    expect(langFromPath('main.rs')).toBe('rust');
  });

  test('maps .go to go', () => {
    expect(langFromPath('main.go')).toBe('go');
  });

  test('maps .java to java', () => {
    expect(langFromPath('Main.java')).toBe('java');
  });

  test('maps .rb to ruby', () => {
    expect(langFromPath('app.rb')).toBe('ruby');
  });

  test('maps .css to css', () => {
    expect(langFromPath('styles.css')).toBe('css');
  });

  test('maps .scss to scss', () => {
    expect(langFromPath('styles.scss')).toBe('scss');
  });

  test('maps .html to html', () => {
    expect(langFromPath('index.html')).toBe('html');
  });

  test('maps .htm to html', () => {
    expect(langFromPath('page.htm')).toBe('html');
  });

  test('maps .json to json', () => {
    expect(langFromPath('package.json')).toBe('json');
  });

  test('maps .yaml to yaml', () => {
    expect(langFromPath('config.yaml')).toBe('yaml');
  });

  test('maps .yml to yaml', () => {
    expect(langFromPath('config.yml')).toBe('yaml');
  });

  test('maps .md to markdown', () => {
    expect(langFromPath('README.md')).toBe('markdown');
  });

  test('maps .sql to sql', () => {
    expect(langFromPath('query.sql')).toBe('sql');
  });

  test('maps .sh to bash', () => {
    expect(langFromPath('deploy.sh')).toBe('bash');
  });

  test('maps .bash to bash', () => {
    expect(langFromPath('script.bash')).toBe('bash');
  });

  test('maps .zsh to bash', () => {
    expect(langFromPath('.zshrc.zsh')).toBe('bash');
  });

  test('maps .svelte to svelte', () => {
    expect(langFromPath('App.svelte')).toBe('svelte');
  });

  test('maps .vue to vue', () => {
    expect(langFromPath('App.vue')).toBe('vue');
  });

  test('maps .c to c', () => {
    expect(langFromPath('main.c')).toBe('c');
  });

  test('maps .h to c', () => {
    expect(langFromPath('header.h')).toBe('c');
  });

  test('maps .cpp to cpp', () => {
    expect(langFromPath('main.cpp')).toBe('cpp');
  });

  test('maps .cs to csharp', () => {
    expect(langFromPath('Program.cs')).toBe('csharp');
  });

  test('maps .swift to swift', () => {
    expect(langFromPath('main.swift')).toBe('swift');
  });

  test('maps .kt to kotlin', () => {
    expect(langFromPath('Main.kt')).toBe('kotlin');
  });

  test('maps .toml to toml', () => {
    expect(langFromPath('Cargo.toml')).toBe('toml');
  });

  test('maps .xml to xml', () => {
    expect(langFromPath('pom.xml')).toBe('xml');
  });

  test('maps .svg to xml', () => {
    expect(langFromPath('icon.svg')).toBe('xml');
  });

  test('maps .graphql to graphql', () => {
    expect(langFromPath('schema.graphql')).toBe('graphql');
  });

  test('maps .lua to lua', () => {
    expect(langFromPath('init.lua')).toBe('lua');
  });

  test('maps .dart to dart', () => {
    expect(langFromPath('main.dart')).toBe('dart');
  });

  test('maps .ex to elixir', () => {
    expect(langFromPath('app.ex')).toBe('elixir');
  });

  test('maps .zig to zig', () => {
    expect(langFromPath('main.zig')).toBe('zig');
  });

  test('maps .tf to terraform', () => {
    expect(langFromPath('main.tf')).toBe('terraform');
  });

  test('handles case-insensitive extensions', () => {
    expect(langFromPath('file.TS')).toBe('typescript');
    expect(langFromPath('file.PY')).toBe('python');
  });

  test('detects Dockerfile by filename', () => {
    expect(langFromPath('Dockerfile')).toBe('dockerfile');
    expect(langFromPath('path/to/Dockerfile')).toBe('dockerfile');
  });

  test('detects Makefile by filename', () => {
    expect(langFromPath('Makefile')).toBe('makefile');
    expect(langFromPath('src/Makefile')).toBe('makefile');
  });

  test('returns null for unknown extensions', () => {
    expect(langFromPath('file.xyz')).toBeNull();
    expect(langFromPath('file.unknown')).toBeNull();
  });

  test('handles deeply nested paths', () => {
    expect(langFromPath('/home/user/project/src/lib/utils/helpers.ts')).toBe('typescript');
  });
});

describe('escapeHtml', () => {
  test('escapes ampersands', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  test('escapes less-than signs', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  test('escapes greater-than signs', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  test('escapes all special chars together', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert("x")&lt;/script&gt;',
    );
  });

  test('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('returns plain text unchanged', () => {
    expect(escapeHtml('Hello world')).toBe('Hello world');
  });

  test('handles multiple ampersands', () => {
    expect(escapeHtml('a & b & c')).toBe('a &amp; b &amp; c');
  });
});

describe('highlightLine', () => {
  test('returns escaped text when lang is null', async () => {
    const result = await highlightLine('<div>Hello</div>', null);
    expect(result).toBe('&lt;div&gt;Hello&lt;/div&gt;');
  });

  test('returns a string for valid code and language', async () => {
    const result = await highlightLine('const x = 1;', 'typescript');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns escaped text for unknown language', async () => {
    const result = await highlightLine('some code', 'nonexistentlang123');
    expect(typeof result).toBe('string');
    // Should at minimum contain the original text content
    expect(result).toContain('some code');
  });
});

describe('highlightLines', () => {
  test('returns escaped lines when lang is null', async () => {
    const result = await highlightLines('<div>\n</div>', null);
    expect(result).toEqual(['&lt;div&gt;', '&lt;/div&gt;']);
  });

  test('returns array of strings for valid input', async () => {
    const code = 'const x = 1;\nconst y = 2;';
    const result = await highlightLines(code, 'typescript');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    result.forEach((line) => {
      expect(typeof line).toBe('string');
    });
  });

  test('returns escaped lines for unknown language', async () => {
    const code = 'line1\nline2';
    const result = await highlightLines(code, 'nonexistentlang123');
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('line1');
    expect(result[1]).toContain('line2');
  });

  test('handles single line input', async () => {
    const result = await highlightLines('hello', null);
    expect(result).toEqual(['hello']);
  });

  test('handles empty string', async () => {
    const result = await highlightLines('', null);
    expect(result).toEqual(['']);
  });
});
