// Test what happens when Claude CLI fails immediately

const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  FORCE_COLOR: '0',
  PYTHONUNBUFFERED: '1',
  CI: '1',
  NONINTERACTIVE: '1',
  TERM: 'dumb',
};
delete env.CLAUDECODE;

// Invalid args - missing required options
const args = [
  '--output-format',
  'stream-json',
  // Missing --verbose, which causes an error!
  '-p',
  'test',
  '--dangerously-skip-permissions',
];

console.log('Spawning with invalid args (missing --verbose)...');

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
let chunkCount = 0;

const readStdout = (async () => {
  for await (const chunk of proc.stdout) {
    const text = decoder.decode(chunk);
    stdout += text;
    chunkCount++;
    console.log('STDOUT chunk:', text.slice(0, 100));
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

const exitCode = await proc.exited;
console.log('\nExit code:', exitCode);
console.log('Stdout chunks:', chunkCount);
console.log('Stdout length:', stdout.length);
console.log('Stderr:', stderr);
console.log('\nQuestion: Did we get ANY stdout even though CLI failed?');
