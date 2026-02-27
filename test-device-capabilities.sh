#!/bin/bash
# Test script for Device Node Actions feature
# This script tests the device capabilities API endpoints

BASE_URL="http://localhost:3002"
API_BASE="${BASE_URL}/api/device"

echo "===== Device Capabilities Test Suite ====="
echo ""

# Test 1: Check device capabilities status
echo "1. Testing GET /capabilities..."
curl -s "${API_BASE}/capabilities" | jq '.'
echo ""

# Test 2: Get storage usage
echo "2. Testing GET /storage..."
curl -s "${API_BASE}/storage" | jq '.'
echo ""

# Test 3: List captured media
echo "3. Testing GET /captures..."
curl -s "${API_BASE}/captures" | jq '.'
echo ""

# Test 4: Request screenshot (permission check)
echo "4. Testing POST /screenshot (should fail if not enabled)..."
curl -s -X POST "${API_BASE}/screenshot" \
  -H "Content-Type: application/json" \
  -d '{"display_index": 0, "format": "png"}' | jq '.'
echo ""

# Test 5: Request location
echo "5. Testing POST /location (should fail if not enabled)..."
curl -s -X POST "${API_BASE}/location" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.'
echo ""

# Test 6: Request camera capture
echo "6. Testing POST /camera (should fail if not enabled)..."
curl -s -X POST "${API_BASE}/camera" \
  -H "Content-Type: application/json" \
  -d '{"mode": "photo"}' | jq '.'
echo ""

echo "===== Test Suite Complete ====="
echo ""
echo "Note: Most tests should fail with permission errors unless device capabilities"
echo "are enabled in Settings > Device. This is expected behavior."
echo ""
echo "To enable device capabilities:"
echo "  1. Start the server: bun run dev"
echo "  2. Open http://localhost:3002"
echo "  3. Go to Settings > Device"
echo "  4. Enable Screenshot, Camera, and/or Location"
echo "  5. Re-run this test script"
