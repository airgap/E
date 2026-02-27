# Kiro CLI Image & Multimodal Support

This document explains how kiro-cli handles images and multimodal input.

## Overview

Kiro CLI supports multimodal development through the Agent Client Protocol (ACP), which allows you to send images alongside text in your prompts. This enables visual development workflows like:

- 📸 Uploading whiteboard photos to start development
- 🎨 Using UI mockups and design sketches as specifications
- 📊 Analyzing diagrams and flowcharts
- 🖼️ Processing screenshots for debugging
- 📐 Converting hand-drawn wireframes into code

## How It Works

### ACP Protocol Support

When you run `kiro-cli acp`, Kiro advertises multimodal capabilities:

```json
{
  "capabilities": {
    "loadSession": true,
    "promptCapabilities": {
      "image": true // ✅ Images supported
    }
  }
}
```

This means Kiro can accept and process image content in prompts through the ACP protocol.

### Built-in Read Tool

Kiro's `read` tool can handle:

- Text files
- Folders
- **Images** ✅

The tool respects configured paths:

```json
{
  "toolsSettings": {
    "read": {
      "allowedPaths": ["~/projects", "./src/**"],
      "deniedPaths": ["./secrets/**"]
    }
  }
}
```

## Real-World Example

From the [Kiro blog](https://kiro.dev/blog/multimodal-development-with-kiro-from-design-to-done/):

> "Instead of manually translating my diagram, I uploaded a photo of my whiteboard directly to Kiro and started a conversation about what I wanted to build. Kiro understood the entities, relationships, and business logic represented in my hand-drawn diagram. Within minutes, it analyzed the visual input and created comprehensive specifications."

## Current Status in E

### ⚠️ Not Yet Integrated

While kiro-cli supports images via ACP, **E's kiro provider hasn't implemented the ACP protocol yet**.

Current implementation:

```typescript
// In cli-provider.ts
function buildKiroCommand(opts: CliSessionOpts): CliCommand {
  const args = ['acp']; // ✅ Spawns ACP mode

  // ❌ But we don't send JSON-RPC messages yet
  // TODO: Implement ACP protocol initialization
  return { binary: resolveBinary('kiro-cli'), args };
}
```

### What's Needed

To enable image support in E with kiro-cli, we need to:

1. **Implement ACP Protocol** (from earlier TODO comments)
   - Send `initialize` JSON-RPC request
   - Send `session/prompt` with multimodal content
   - Handle JSON-RPC responses

2. **Add Image Input Handling**
   - Accept images in message input
   - Encode images as base64
   - Format as ACP-compatible content blocks

3. **Update Message Format**
   - Support multimodal content arrays
   - Include image metadata (type, source)

## ACP Image Format

Based on ACP specification, images are likely sent as content blocks:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/prompt",
  "params": {
    "prompt": [
      {
        "type": "text",
        "text": "What's in this image?"
      },
      {
        "type": "image",
        "source": {
          "type": "base64",
          "media_type": "image/png",
          "data": "iVBORw0KGgoAAAANSUhEUgAA..."
        }
      }
    ]
  }
}
```

## Comparison with Claude Code

| Feature             | Claude Code           | Kiro CLI (ACP)              |
| ------------------- | --------------------- | --------------------------- |
| **Image Input**     | ✅ Via `--image` flag | ✅ Via ACP protocol         |
| **Base64 Encoding** | ✅ Automatic          | ✅ In ACP messages          |
| **Image URLs**      | ✅ Supported          | ⚠️ Unknown                  |
| **Screenshot Tool** | ✅ Built-in           | ⚠️ Via MCP/tools            |
| **Vision Models**   | ✅ Claude 3+          | ✅ Configured per agent     |
| **Multi-image**     | ✅ Multiple images    | ✅ Likely via content array |

## Implementation Roadmap

### Phase 1: ACP Protocol Foundation

- [ ] Implement JSON-RPC 2.0 communication
- [ ] Send `initialize` request on startup
- [ ] Handle capability negotiation
- [ ] Test basic text prompts via ACP

### Phase 2: Text-Only Prompts

- [ ] Send `session/new` for new conversations
- [ ] Send `session/prompt` for messages
- [ ] Parse JSON-RPC responses
- [ ] Stream content chunks to client

### Phase 3: Image Support

- [ ] Add image input to message interface
- [ ] Encode images as base64
- [ ] Format multimodal content blocks
- [ ] Test with whiteboard photos

### Phase 4: Advanced Features

- [ ] Multiple images per message
- [ ] Image URLs (if supported)
- [ ] Screenshot capture integration
- [ ] Image metadata handling

## Supported Image Formats

**Unknown** - Documentation doesn't specify, but likely:

- PNG ✅ (common)
- JPEG/JPG ✅ (common)
- WebP ⚠️ (possibly)
- GIF ⚠️ (possibly)
- SVG ❓ (unknown)

**Recommendation**: Test with PNG and JPEG first.

## File Size Limits

**Unknown** - Documentation doesn't specify limits.

**Recommendation**:

- Keep images under 5MB for performance
- Resize high-res images before sending
- Compress screenshots to reduce size

## Best Practices

### 1. Optimize Images First

```bash
# Resize large images
convert large-image.png -resize 1920x1080\> optimized.png

# Compress screenshots
pngquant --quality=65-80 screenshot.png
```

### 2. Use Clear Visual Context

When sending images:

- Add descriptive text explaining what to look for
- Highlight important areas if possible
- Provide context about the image purpose

### 3. Test Incrementally

Start with:

1. Simple diagrams
2. Screenshots with clear UI
3. Whiteboard photos with good lighting
4. Complex multi-image workflows

## Examples (Once Implemented)

### Example 1: UI Mockup to Code

```typescript
// Future implementation
await sendMessage({
  conversationId: 'conv-123',
  content: 'Implement this login page',
  images: [
    {
      type: 'base64',
      mediaType: 'image/png',
      data: base64EncodedMockup,
    },
  ],
});
```

### Example 2: Debug with Screenshot

```typescript
await sendMessage({
  conversationId: 'conv-123',
  content: 'Why is this button not aligned? See screenshot.',
  images: [
    {
      type: 'base64',
      mediaType: 'image/png',
      data: base64Screenshot,
    },
  ],
});
```

### Example 3: Whiteboard Analysis

```typescript
await sendMessage({
  conversationId: 'conv-123',
  content: 'Convert this architecture diagram to a system design document',
  images: [
    {
      type: 'base64',
      mediaType: 'image/jpeg',
      data: base64WhiteboardPhoto,
    },
  ],
});
```

## Troubleshooting

### "Image not recognized"

- Ensure image is properly base64 encoded
- Check image format is supported (use PNG/JPEG)
- Verify image size is reasonable (<5MB)

### "ACP protocol error"

- Check kiro-cli is properly installed
- Verify ACP mode is active (`kiro-cli acp`)
- Review JSON-RPC message format

### "Vision capabilities not available"

- Ensure Kiro agent is configured with vision-capable model
- Check model supports multimodal input
- Verify `promptCapabilities.image: true` in capabilities

## Resources

- [Kiro Multimodal Blog Post](https://kiro.dev/blog/multimodal-development-with-kiro-from-design-to-done/)
- [Kiro ACP Documentation](https://kiro.dev/docs/cli/acp/)
- [ACP Protocol Spec](https://kiro.dev/blog/kiro-adopts-acp/)
- [Built-in Tools (Read)](https://kiro.dev/docs/cli/reference/built-in-tools/)

## Related Documentation

- `tool-calling-implementation.md` - Tool calling roadmap
- `provider-feature-matrix.md` - Feature comparison across providers
- `../cli-provider.ts` - Current Kiro CLI implementation

## Next Steps

1. Review ACP protocol specification
2. Implement JSON-RPC communication layer
3. Test text-only prompts first
4. Add image encoding support
5. Test with real images
6. Document learned limitations and best practices
