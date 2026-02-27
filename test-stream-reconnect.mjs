import { chromium } from 'playwright';

/**
 * Test script to verify stream reconnection after page reload.
 *
 * This test:
 * 1. Opens the app
 * 2. Starts a conversation with a streaming response
 * 3. Reloads the page mid-stream
 * 4. Verifies the stream reconnects and continues
 */

async function testStreamReconnect() {
  console.log('🧪 Starting stream reconnection test...\n');

  const browser = await chromium.launch({
    headless: true, // Headless mode (no X server needed)
    slowMo: 100, // Slight delay for realism
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Enable console logging from the page
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[sse') || text.includes('[stream') || text.includes('reconnect')) {
        console.log(`  📄 Browser: ${text}`);
      }
    });

    console.log('1️⃣  Opening app at http://localhost:3335...');
    await page.goto('http://localhost:3335', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    console.log('2️⃣  Waiting for app to initialize...');
    // Wait for the chat input to be visible
    await page.waitForSelector('[data-testid="chat-input"], textarea, .chat-input', {
      timeout: 10000,
    });

    console.log('3️⃣  Checking workspace state...');
    const hasWorkspace = await page.evaluate(() => {
      return window.localStorage.getItem('e-workspaces') !== null;
    });
    console.log(`    Workspace in localStorage: ${hasWorkspace}`);

    console.log('4️⃣  Starting a conversation with streaming response...');
    const input = await page.locator('textarea').first();
    await input.fill(
      'Write a long story about a robot learning to code. Make it at least 500 words.',
    );

    // Find and click the send button
    const sendButton = await page.locator('button:has-text("Send"), button[type="submit"]').first();
    await sendButton.click();

    console.log('5️⃣  Waiting for stream to start...');
    await page.waitForTimeout(2000);

    // Wait for streaming indicator or content to appear
    await page.waitForSelector('.streaming, [data-streaming="true"], .message-bubble', {
      timeout: 10000,
    });

    console.log('6️⃣  Stream started! Waiting 3 seconds for content to accumulate...');
    await page.waitForTimeout(3000);

    // Check stream state before reload
    const beforeReload = await page.evaluate(() => {
      const store = window.__e_stream_store;
      return {
        isStreaming: store?.isStreaming,
        sessionId: store?.sessionId,
        conversationId: store?.conversationId,
        contentBlocks: store?.contentBlocks?.length || 0,
      };
    });
    console.log('    Stream state before reload:', beforeReload);

    console.log('7️⃣  🔄 RELOADING PAGE...');
    await page.reload({ waitUntil: 'networkidle' });

    console.log('8️⃣  Page reloaded. Waiting for reconnection...');
    await page.waitForTimeout(3000);

    // Check if reconnection happened
    const afterReload = await page.evaluate(() => {
      const store = window.__e_stream_store;
      return {
        isStreaming: store?.isStreaming,
        isReconnecting: store?.isReconnecting,
        sessionId: store?.sessionId,
        conversationId: store?.conversationId,
        contentBlocks: store?.contentBlocks?.length || 0,
        status: store?.status,
      };
    });

    console.log('    Stream state after reload:', afterReload);

    // Verify the conversation is still active
    const conversationVisible = await page.locator('.message-bubble, .streaming-message').count();
    console.log(`    Message bubbles visible: ${conversationVisible}`);

    // Check localStorage to see if workspace/conversation was preserved
    const workspaceData = await page.evaluate(() => {
      const ws = window.localStorage.getItem('e-workspaces');
      return ws ? JSON.parse(ws) : null;
    });
    console.log(
      '    Active conversation ID from workspace:',
      workspaceData?.workspaces?.[0]?.snapshot?.activeConversationId || 'none',
    );

    console.log('\n✅ Test completed!');
    console.log('\n📊 Results:');
    console.log(`   - Before reload: ${beforeReload.contentBlocks} content blocks`);
    console.log(`   - After reload: ${afterReload.contentBlocks} content blocks`);
    console.log(`   - Session ID preserved: ${beforeReload.sessionId === afterReload.sessionId}`);
    console.log(
      `   - Conversation ID preserved: ${beforeReload.conversationId === afterReload.conversationId}`,
    );
    console.log(
      `   - Stream reconnected: ${afterReload.isStreaming || afterReload.status === 'streaming'}`,
    );
    console.log(`   - Messages visible: ${conversationVisible > 0}`);

    if (conversationVisible > 0 && afterReload.conversationId) {
      console.log('\n✅ SUCCESS: Stream reconnection appears to be working!');
    } else {
      console.log('\n⚠️  WARNING: Stream may not have reconnected properly.');
    }

    // Keep browser open for 5 more seconds for manual inspection
    console.log('\n⏳ Keeping browser open for 5 seconds for inspection...');
    await page.waitForTimeout(5000);
  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error('Stack trace:', error.stack);
    throw error;
  } finally {
    await browser.close();
  }
}

// Check if server is running
console.log('Checking if dev server is running at http://localhost:3335...');
try {
  const response = await fetch('http://localhost:3335');
  if (response.ok) {
    console.log('✅ Server is running!\n');
    await testStreamReconnect();
  }
} catch (error) {
  console.error('❌ Test runner failed:', error.message);
  console.error('   Error:', error);
  process.exit(1);
}
