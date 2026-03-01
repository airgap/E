// Test with CLAUDE_API_KEY in environment

const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  FORCE_COLOR: '0',
  PYTHONUNBUFFERED: '1',
  CI: '1',
  NONINTERACTIVE: '1',
  TERM: 'dumb',
  CLAUDE_API_KEY: process.env.ANTHROPIC_API_KEY || 'sk-ant-placeholder',
};
delete env.CLAUDECODE;

console.log('Testing with CLAUDE_API_KEY set');

const args = [
  '--output-format',
  'stream-json',
  '--verbose',
  '-p',
  'What is 1+1? Reply with just the number.',
  '--dangerously-skip-permissions',
];

const proc = Bun.spawn(['claude', ...args], {
  cwd: '/tmp',
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'pipe',
  env,
});

console.log('PID:', proc.pid);

const decoder = new TextDecoder();
let stdout = '';
let stderr = '';

const timeout = setTimeout(() => {
  console.log('TIMEOUT - killing process');
  proc.kill();
}, 10000);

const readStdout = (async () => {
  for await (const chunk of proc.stdout) {
    const text = decoder.decode(chunk);
    stdout += text;
    console.log('STDOUT:', text.slice(0, 100));
  }
})();

const readStderr = (async () => {
  for await (const chunk of proc.stderr) {
    const text = decoder.decode(chunk);
    stderr += text;
    console.log('STDERR:', text);
  }
})();

await Promise.all([readStdout, readStderr]);
clearTimeout(timeout);

const exitCode = await proc.exited;
console.log('\nExit code:', exitCode);
console.log('Stdout length:', stdout.length);
console.log('Stderr length:', stderr.length);

if (stderr) {
  console.log('\nFull stderr:', stderr);
}
