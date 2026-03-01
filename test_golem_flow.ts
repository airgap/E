import { nanoid } from 'nanoid';
import { getDb } from '/raid/E/packages/server/src/db/database';
import { claudeManager } from '/raid/E/packages/server/src/services/claude-process';

async function testGolemFlow() {
  console.log('Starting golem flow test...');

  const conversationId = nanoid();
  const now = Date.now();
  const db = getDb();

  // Step 1: Create conversation
  console.log('Creating conversation...');
  db.query(
    `INSERT INTO conversations (id, title, model, system_prompt, workspace_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    conversationId,
    '[Test] Golem Flow Test',
    'claude-sonnet-4-6',
    'You are a helpful coding assistant',
    '/tmp',
    now,
    now,
  );

  // Add user message
  db.query(
    `INSERT INTO messages (id, conversation_id, role, content, timestamp)
     VALUES (?, ?, 'user', ?, ?)`,
  ).run(
    nanoid(),
    conversationId,
    JSON.stringify([{ type: 'text', text: 'What is 2+2? Reply with just the number.' }]),
    now,
  );

  console.log(`Created conversation: ${conversationId}`);

  // Step 2: Create session
  console.log('Creating Claude session...');
  const sessionId = await claudeManager.createSession(conversationId, {
    model: 'claude-sonnet-4-6',
    workspacePath: '/tmp',
    effort: 'low',
  });
  console.log(`Created session: ${sessionId}`);

  // Step 3: Send message
  console.log('Sending message...');
  const stream = await claudeManager.sendMessage(
    sessionId,
    'What is 2+2? Reply with just the number.',
  );

  // Step 4: Read stream
  console.log('Reading stream...');
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let receivedData = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    receivedData = true;
    console.log('CHUNK:', chunk.slice(0, 200));
  }

  if (receivedData) {
    console.log('✅ SUCCESS: Received data from Claude!');
  } else {
    console.log('❌ FAILURE: No data received from Claude');
  }

  // Check messages in database
  const messages = db
    .query(
      `SELECT role, substr(content, 1, 100) as content FROM messages WHERE conversation_id = ?`,
    )
    .all(conversationId) as any[];

  console.log('\nMessages in database:');
  for (const msg of messages) {
    console.log(`  ${msg.role}: ${msg.content}`);
  }
}

testGolemFlow().catch(console.error);
