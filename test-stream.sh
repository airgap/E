#!/bin/bash
# Test streaming to the broken conversation

CONVERSATION_ID="EG2KLrVrrrQAKQAeYAxtP"
MESSAGE="Hello, testing if streaming works"

echo "=== Testing Stream to Conversation $CONVERSATION_ID ==="
echo ""
echo "Sending message: $MESSAGE"
echo ""

# Send the message and capture the response
curl -X POST "http://localhost:3002/api/stream/$CONVERSATION_ID" \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"$MESSAGE\"}" \
  --no-buffer \
  2>&1 | tee /tmp/stream-test.log

echo ""
echo ""
echo "=== Stream complete. Checking database... ==="
sqlite3 ~/.e/e.db "SELECT role, substr(content, 1, 80) FROM messages WHERE conversation_id = '$CONVERSATION_ID' ORDER BY timestamp DESC LIMIT 3;"
