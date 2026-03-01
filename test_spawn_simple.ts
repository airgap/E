// Test spawning Claude CLI exactly as golem does

const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  FORCE_COLOR: '0',
  PYTHONUNBUFFERED: '1',
  PYTHONIOENCODING: 'utf-8:strict',
  CI: '1',
  NONINTERACTIVE: '1',
  TERM: 'dumb',
};
delete env.CLAUDECODE;

console.log('Environment check:');
console.log('  CLAUDECODE:', env.CLAUDECODE);
console.log('  HOME:', env.HOME);
console.log('  CI:', env.CI);

const args = [
  '--output-format',
  'stream-json',
  '--verbose',
  '-p',
  'What is 1+1? Reply with just the number.',
  '--dangerously-skip-permissions',
];

console.log('\nSpawning:', 'claude', args.join(' '));

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
    if (chunkCount <= 3) {
      console.log('STDOUT chunk:', text.slice(0, 150));
    }
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
console.log('Total stdout bytes:', stdout.length);
console.log('Total stderr bytes:', stderr.length);
console.log('Chunk count:', chunkCount);

if (exitCode === 0 && stdout.length > 0) {
  console.log('\n✅ SUCCESS: Claude responded!');
} else {
  console.log('\n❌ FAILURE');
  if (stderr) console.log('Error:', stderr.slice(0, 500));
}
