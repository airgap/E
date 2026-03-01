// Test spawning Claude with the actual MCP config

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
  'What is 1+1? Reply with just the number.',
  '--dangerously-skip-permissions',
  '--mcp-config',
  '/home/nicole/.e/mcp-config.json',
];

console.log('Spawning with full MCP config...');
console.log(
  'MCP servers will need to start: full-server, desktop-commander, puppeteer, memory, github, e-work, e-ask-user',
);

const proc = Bun.spawn(['claude', ...args], {
  cwd: '/tmp',
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'pipe',
  env,
});

console.log('PID:', proc.pid);
console.log('Waiting for response (30s timeout)...');

const decoder = new TextDecoder();
let stdout = '';
let stderr = '';
let chunkCount = 0;

const timeout = setTimeout(() => {
  console.log('⏱️  TIMEOUT - killing process');
  console.log('This suggests MCP servers are hanging during startup');
  proc.kill();
}, 30000);

const readStdout = (async () => {
  for await (const chunk of proc.stdout) {
    const text = decoder.decode(chunk);
    stdout += text;
    chunkCount++;
    if (chunkCount <= 5) {
      console.log(`Chunk ${chunkCount}:`, text.slice(0, 100));
    }
  }
})();

const readStderr = (async () => {
  for await (const chunk of proc.stderr) {
    const text = decoder.decode(chunk);
    stderr += text;
    if (stderr.length < 1000) {
      console.log('STDERR:', text.slice(0, 200));
    }
  }
})();

await Promise.all([readStdout, readStderr]);
clearTimeout(timeout);

const exitCode = await proc.exited;
console.log('\nExit code:', exitCode);
console.log('Chunks received:', chunkCount);
console.log('Total stdout:', stdout.length);
console.log('Total stderr:', stderr.length);

if (chunkCount > 0) {
  console.log('✅ SUCCESS - Claude responded!');
} else {
  console.log('❌ FAILURE - No response from Claude');
  if (stderr) console.log('Stderr:', stderr.slice(0, 500));
}
