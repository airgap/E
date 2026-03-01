import { LocalWorktreeExecutor } from './packages/server/src/services/loop/executor/local-worktree-executor';
import type { ExecutionContext } from '@e/shared';
import { nanoid } from 'nanoid';

async function testGolemExecutor() {
  console.log('=== Testing Golem Executor ===');

  const executor = new LocalWorktreeExecutor();

  const context: ExecutionContext = {
    executionId: nanoid(),
    repoUrl: '/raid/E',
    branch: 'main',
    workspacePath: '/raid/E',
    storyId: 'test-story',
    storyTitle: 'Test Story',
    prdId: null,
    prompt: 'What is 2+2? Reply with just the number and nothing else.',
    systemPrompt: 'You are a helpful assistant.',
    llmConfig: {
      model: 'claude-sonnet-4-6',
      effort: 'low',
    },
    secretsRefs: {},
    resourceConstraints: {
      maxDurationMs: 60000, // 1 minute for test
    },
    qualityChecks: [],
    autoCommit: false,
    timeout: 60000,
    preallocatedConversationId: nanoid(),
  };

  console.log('Starting execution...');
  const result = await executor.execute(context);

  console.log('\n=== RESULT ===');
  console.log('Status:', result.status);
  console.log('Agent output length:', result.agentOutput?.length || 0);
  console.log('Agent error:', result.agentError || '(none)');
  console.log('Conversation ID:', result.conversationId);
  console.log('Agent ID:', result.agentId);
  console.log('Duration:', result.duration, 'ms');
  console.log('Logs:', result.logs);

  if (result.agentOutput) {
    console.log('\nAgent output preview:', result.agentOutput.slice(0, 500));
  }
}

testGolemExecutor().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
