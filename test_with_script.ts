// Test using script wrapper like golem does

const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  FORCE_COLOR: '0',
  PYTHONUNBUFFERED: '1',
  CI: '1',
  NONINTERACTIVE: '1',
  TERM: 'dumb',
};
delete env.CLAUDECODE;

const args = [
  '--output-format',
  'stream-json',
  '--verbose',
  '-p',
  'What is 1+1?',
  '--dangerously-skip-permissions',
];

// Build command string for script -c
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

const escaped = ['claude', ...args].map(shellEscape).join(' ');
const command = `stty -echo 2>/dev/null; ${escaped}`;

console.log('Using script wrapper');
console.log('Command:', command.slice(0, 150));

const proc = Bun.spawn(['script', '-qec', command, '/dev/null'], {
  cwd: '/tmp',
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
  env,
});

console.log('PID:', proc.pid);

const decoder = new TextDecoder();
let stdout = '';
let stderr = '';

const timeout = setTimeout(() => {
  console.log('TIMEOUT - killing');
  proc.kill();
}, 12000);

const readStdout = (async () => {
  for await (const chunk of proc.stdout) {
    const text = decoder.decode(chunk);
    stdout += text;
    if (stdout.length < 500) {
      console.log('STDOUT:', text.slice(0, 100));
    }
  }
})();

const readStderr = (async () => {
  for await (const chunk of proc.stderr) {
    const text = decoder.decode(chunk);
    stderr += text;
    console.log('STDERR:', text.slice(0, 200));
  }
})();

await Promise.all([readStdout, readStderr]);
clearTimeout(timeout);

const exitCode = await proc.exited;
console.log('\nExit code:', exitCode);
console.log('Stdout length:', stdout.length);
console.log('Stderr length:', stderr.length);

if (exitCode === 0 && stdout.length > 0) {
  console.log('✅ SUCCESS');
} else {
  console.log('❌ FAILURE');
}
