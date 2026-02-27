#!/bin/bash
# Debug script for E chat session issues

echo "=== E Chat Session Diagnostics ==="
echo ""

echo "1. Checking database state..."
sqlite3 ~/.e/e.db "SELECT id, title, cli_session_id, permission_mode, model FROM conversations WHERE id = 'EG2KLrVrrrQAKQAeYAxtP';"
echo ""

echo "2. Checking recent messages..."
sqlite3 ~/.e/e.db "SELECT role, timestamp, length(content) as content_len FROM messages WHERE conversation_id = 'EG2KLrVrrrQAKQAeYAxtP' ORDER BY timestamp DESC LIMIT 5;"
echo ""

echo "3. Checking active streaming sessions..."
curl -s http://localhost:3002/api/stream/sessions | jq '.'
echo ""

echo "4. Checking Claude CLI processes..."
ps aux | grep -i claude | grep -v grep | grep -v "debug-session"
echo ""

echo "5. Checking server status..."
curl -s http://localhost:3002/health | jq '.'
echo ""

echo "=== Next Steps ==="
echo "If sessions are empty and no CLI processes for conversation EG2KLrVrrrQAKQAeYAxtP,"
echo "try sending a new message from the UI. The session should be recreated."
