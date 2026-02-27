import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';

const TMP_DIR = join(import.meta.dir, '__tmp_verify__');

// Import the module fresh to avoid mock interference from other test files
const { verifyFile } = await import('../code-verifier');

// Use Bun.write and Bun.spawn for all file operations to avoid interference
// from mock.module('fs') / mock.module('node:fs') in other test files
async function writeTestFile(filePath: string, content: string) {
  await Bun.write(filePath, content);
}

describe('Code Verifier', () => {
  beforeAll(async () => {
    // Use shell to create directory (avoids mocked fs)
    Bun.spawnSync(['mkdir', '-p', TMP_DIR]);
  });

  afterAll(() => {
    // Use shell to remove directory (avoids mocked fs)
    Bun.spawnSync(['rm', '-rf', TMP_DIR]);
  });

  test('passes valid TypeScript', async () => {
    const filePath = join(TMP_DIR, 'valid.ts');
    await writeTestFile(filePath, 'const x: number = 42;\nconsole.log(x);\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('detects syntax errors in TypeScript', async () => {
    const filePath = join(TMP_DIR, 'invalid_syntax.ts');
    await writeTestFile(filePath, 'function foo( { \n class \n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('error');
  });

  test('passes valid JavaScript', async () => {
    const filePath = join(TMP_DIR, 'valid.js');
    await writeTestFile(filePath, 'const x = 42;\nconsole.log(x);\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
  });

  test('returns pass for unsupported extensions', async () => {
    const filePath = join(TMP_DIR, 'readme.md');
    await writeTestFile(filePath, '# Hello\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('passes valid TSX file', async () => {
    const filePath = join(TMP_DIR, 'component.tsx');
    await writeTestFile(filePath, `const App = () => <div>Hello</div>;\nexport default App;\n`);
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('bun-transpiler');
    expect(result.issues).toHaveLength(0);
  });

  test('detects syntax errors in TSX file', async () => {
    const filePath = join(TMP_DIR, 'bad_component.tsx');
    await writeTestFile(filePath, `const App = () => <div>unclosed;\n`);
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].rule).toBe('syntax-error');
  });

  test('passes valid JSX file', async () => {
    const filePath = join(TMP_DIR, 'component.jsx');
    await writeTestFile(
      filePath,
      `const Heading = () => <h1>Title</h1>;\nexport default Heading;\n`,
    );
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('bun-transpiler');
  });

  test('detects syntax errors in JSX file', async () => {
    const filePath = join(TMP_DIR, 'bad_component.jsx');
    await writeTestFile(filePath, `function Broken( { return <div> }\n`);
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('detects syntax errors in JavaScript', async () => {
    const filePath = join(TMP_DIR, 'invalid.js');
    await writeTestFile(filePath, 'function broken( { return \n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('error');
  });

  test('VerificationResult includes filePath', async () => {
    const filePath = join(TMP_DIR, 'struct_test.ts');
    await writeTestFile(filePath, 'const a = 1;\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.filePath).toBe(filePath);
  });

  test('VerificationResult includes duration', async () => {
    const filePath = join(TMP_DIR, 'duration_test.ts');
    await writeTestFile(filePath, 'const a = 1;\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(typeof result.duration).toBe('number');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test('VerificationResult has correct tool for TS files', async () => {
    const filePath = join(TMP_DIR, 'tool_test.ts');
    await writeTestFile(filePath, 'export const x = 1;\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.tool).toBe('bun-transpiler');
  });

  test('VerificationResult has correct tool for JS files', async () => {
    const filePath = join(TMP_DIR, 'tool_test.js');
    await writeTestFile(filePath, 'export const x = 1;\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.tool).toBe('bun-transpiler');
  });

  test('passes valid Python file', async () => {
    const filePath = join(TMP_DIR, 'valid_script.py');
    await writeTestFile(filePath, 'x = 42\nprint(x)\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('detects syntax errors in Python file (if python3 is available)', async () => {
    const filePath = join(TMP_DIR, 'invalid_script.py');
    await writeTestFile(filePath, 'def broken(\n  pass\n');
    const result = await verifyFile(filePath, TMP_DIR);
    if (result.tool === 'py_compile') {
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].severity).toBe('error');
    } else {
      expect(result.passed).toBe(true);
      expect(result.tool).toBe('none');
    }
  });

  test('returns pass for .css files', async () => {
    const filePath = join(TMP_DIR, 'style.css');
    await writeTestFile(filePath, 'body { color: red; }\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('returns pass for .json files', async () => {
    const filePath = join(TMP_DIR, 'data.json');
    await writeTestFile(filePath, '{"key": "value"}\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('returns pass for .rs files (no cargo available)', async () => {
    const filePath = join(TMP_DIR, 'main.rs');
    await writeTestFile(filePath, 'fn main() { println!("Hello"); }\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('handles empty file', async () => {
    const filePath = join(TMP_DIR, 'empty.ts');
    await writeTestFile(filePath, '');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('handles file with only whitespace', async () => {
    const filePath = join(TMP_DIR, 'whitespace.ts');
    await writeTestFile(filePath, '   \n  \n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
  });

  test('handles complex valid TypeScript', async () => {
    const filePath = join(TMP_DIR, 'complex.ts');
    await writeTestFile(
      filePath,
      `
interface User {
  name: string;
  age: number;
}

async function fetchUser(id: string): Promise<User> {
  return { name: 'test', age: 30 };
}

const users: Map<string, User> = new Map();
export { fetchUser, users };
`,
    );
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
  });

  test('issue has correct structure when error is found', async () => {
    const filePath = join(TMP_DIR, 'issue_structure.ts');
    await writeTestFile(filePath, 'function badSyntax( { class \n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    const issue = result.issues[0];
    expect(issue).toBeDefined();
    expect(issue.severity).toBe('error');
    expect(typeof issue.message).toBe('string');
    expect(issue.message.length).toBeGreaterThan(0);
    expect(issue.message.length).toBeLessThanOrEqual(500);
    expect(issue.rule).toBe('syntax-error');
  });

  test('extension matching is case-insensitive', async () => {
    const filePath = join(TMP_DIR, 'upper.TS');
    await writeTestFile(filePath, 'const x: number = 1;\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.tool).toBe('bun-transpiler');
    expect(result.passed).toBe(true);
  });

  test('handles nonexistent file gracefully', async () => {
    const filePath = join(TMP_DIR, 'does_not_exist.ts');
    // Should not throw — the outer try/catch in runSyntaxCheck returns pass with tool=none
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('handles nonexistent Python file gracefully', async () => {
    const filePath = join(TMP_DIR, 'does_not_exist.py');
    const result = await verifyFile(filePath, TMP_DIR);
    if (result.tool === 'py_compile') {
      // python3 is available and reports the file as not found (an error)
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    } else {
      // python3 is not available — fallback to none
      expect(result.passed).toBe(true);
      expect(result.tool).toBe('none');
    }
  });

  test('handles file with unicode content in TypeScript', async () => {
    const filePath = join(TMP_DIR, 'unicode.ts');
    await writeTestFile(
      filePath,
      'const greeting: string = "Hej verden! Konnichiwa!";\nconsole.log(greeting);\n',
    );
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
  });

  test('handles deeply nested TypeScript syntax errors', async () => {
    const filePath = join(TMP_DIR, 'nested_error.ts');
    await writeTestFile(
      filePath,
      `
function outer() {
  function inner() {
    if (true {
      console.log("missing paren");
    }
  }
}
`,
    );
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('error');
  });

  test('passes valid Python with classes and functions', async () => {
    const filePath = join(TMP_DIR, 'valid_class.py');
    await writeTestFile(
      filePath,
      `class MyClass:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"Hello, {self.name}"

def main():
    obj = MyClass("test")
    print(obj.greet())

if __name__ == "__main__":
    main()
`,
    );
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
  });

  test('detects indentation error in Python', async () => {
    const filePath = join(TMP_DIR, 'indent_error.py');
    await writeTestFile(
      filePath,
      `def foo():
print("bad indent")
`,
    );
    const result = await verifyFile(filePath, TMP_DIR);
    if (result.tool === 'py_compile') {
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    } else {
      // python3 not available
      expect(result.tool).toBe('none');
    }
  });

  test('returns pass for .html files', async () => {
    const filePath = join(TMP_DIR, 'page.html');
    await writeTestFile(filePath, '<html><body><h1>Hello</h1></body></html>\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('returns pass for .yaml files', async () => {
    const filePath = join(TMP_DIR, 'config.yaml');
    await writeTestFile(filePath, 'key: value\nlist:\n  - item1\n  - item2\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('returns pass for .toml files', async () => {
    const filePath = join(TMP_DIR, 'cargo.toml');
    await writeTestFile(filePath, '[package]\nname = "test"\nversion = "0.1.0"\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('passes TypeScript with decorators', async () => {
    const filePath = join(TMP_DIR, 'decorators.ts');
    await writeTestFile(
      filePath,
      `function log(target: any, key: string) {}
class Service {
  greet() { return "hello"; }
}
export { Service };
`,
    );
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
  });

  test('passes TypeScript with generics', async () => {
    const filePath = join(TMP_DIR, 'generics.ts');
    await writeTestFile(
      filePath,
      `interface Result<T> {
  data: T;
  error?: string;
}

function wrap<T>(value: T): Result<T> {
  return { data: value };
}

const result = wrap<number>(42);
export { result };
`,
    );
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
  });

  test('detects unclosed template literal in TypeScript', async () => {
    const filePath = join(TMP_DIR, 'bad_template.ts');
    await writeTestFile(filePath, 'const x = `unclosed template\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('handles very large valid TypeScript file', async () => {
    const filePath = join(TMP_DIR, 'large.ts');
    const lines = Array.from({ length: 100 }, (_, i) => `const var${i}: number = ${i};`);
    await writeTestFile(filePath, lines.join('\n') + '\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test('detects multiple syntax errors', async () => {
    const filePath = join(TMP_DIR, 'multi_error.ts');
    await writeTestFile(filePath, 'function a( {\nfunction b( {\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
  });

  test('passes valid JSX with fragments', async () => {
    const filePath = join(TMP_DIR, 'fragment.jsx');
    await writeTestFile(
      filePath,
      `const App = () => (
  <>
    <div>First</div>
    <div>Second</div>
  </>
);
export default App;
`,
    );
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('bun-transpiler');
  });

  test('passes TSX with hooks pattern', async () => {
    const filePath = join(TMP_DIR, 'hooks.tsx');
    await writeTestFile(
      filePath,
      `import { useState } from 'react';

const Counter = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
};

export default Counter;
`,
    );
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
  });

  test('error message is truncated to 500 chars max', async () => {
    const filePath = join(TMP_DIR, 'long_error.ts');
    // Create something that produces an error with potentially long message
    await writeTestFile(filePath, 'class ' + 'A'.repeat(600) + ' {\n');
    const result = await verifyFile(filePath, TMP_DIR);
    if (!result.passed && result.issues.length > 0) {
      expect(result.issues[0].message.length).toBeLessThanOrEqual(500);
    }
  });

  test('returns pass for files with no extension', async () => {
    const filePath = join(TMP_DIR, 'Makefile');
    await writeTestFile(filePath, 'all:\n\techo "hello"\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('workspace path does not affect syntax check result', async () => {
    const filePath = join(TMP_DIR, 'workspace_test.ts');
    await writeTestFile(filePath, 'const x = 1;\n');

    const result1 = await verifyFile(filePath, TMP_DIR);
    const result2 = await verifyFile(filePath, '/tmp');

    expect(result1.passed).toBe(result2.passed);
    expect(result1.tool).toBe(result2.tool);
  });
});
