# AWS Bedrock Integration

This document explains how to use AWS Bedrock models with E.

## Overview

AWS Bedrock provides access to Claude models through AWS infrastructure. This integration allows you to use Claude models via AWS Bedrock instead of the direct Anthropic API.

## Prerequisites

1. **AWS Account** with Bedrock access enabled
2. **AWS Credentials** configured on your system
3. **Model Access** enabled in AWS Bedrock console

### Enabling Model Access

1. Go to the AWS Bedrock console
2. Navigate to "Model access" in the left sidebar
3. Request access to Claude models (Claude 3 Opus, Sonnet 3.5, Haiku 3)
4. Wait for approval (usually instant for most accounts)

## AWS Credentials Setup

The Bedrock provider uses the standard AWS SDK credential chain. Configure credentials using one of these methods:

### Option 1: Environment Variables

```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1  # Optional, defaults to us-east-1
```

### Option 2: AWS CLI Configuration

```bash
aws configure
```

### Option 3: IAM Role (EC2/ECS)

If running on AWS infrastructure, use IAM roles for EC2/ECS instances.

## Required IAM Permissions

Your AWS credentials need the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude-*"
    }
  ]
}
```

## Usage

### Model Names

Use the `bedrock:` prefix to route requests to AWS Bedrock:

- `bedrock:claude-opus-4` - Claude 3 Opus
- `bedrock:claude-sonnet-3.5` - Claude 3.5 Sonnet (recommended)
- `bedrock:claude-haiku-3` - Claude 3 Haiku

You can also use full Bedrock model IDs:

- `bedrock:anthropic.claude-3-opus-20240229-v1:0`
- `bedrock:anthropic.claude-3-5-sonnet-20241022-v2:0`
- `bedrock:anthropic.claude-3-haiku-20240307-v1:0`

### Creating a Conversation

When creating a conversation, specify a Bedrock model:

```json
{
  "title": "My Bedrock Chat",
  "model": "bedrock:claude-sonnet-3.5"
}
```

### Changing Provider in Settings

You can set Bedrock as the default provider in settings:

```json
{
  "cliProvider": "bedrock",
  "model": "bedrock:claude-sonnet-3.5"
}
```

## Pricing

AWS Bedrock uses on-demand pricing (same as direct Anthropic API):

| Model             | Input (per M tokens) | Output (per M tokens) |
| ----------------- | -------------------- | --------------------- |
| Claude 3 Opus     | $15.00               | $75.00                |
| Claude 3.5 Sonnet | $3.00                | $15.00                |
| Claude 3 Haiku    | $0.25                | $1.25                 |

Pricing is for the us-east-1 region. Other regions may vary slightly.

## Regions

By default, the Bedrock provider uses `us-east-1`. To use a different region:

```bash
export AWS_REGION=us-west-2
```

Available regions with Bedrock:

- us-east-1 (N. Virginia)
- us-west-2 (Oregon)
- eu-central-1 (Frankfurt)
- ap-southeast-1 (Singapore)
- ap-northeast-1 (Tokyo)

## Troubleshooting

### "Access Denied" Errors

1. Verify model access is enabled in the Bedrock console
2. Check IAM permissions include `bedrock:InvokeModelWithResponseStream`
3. Ensure the model ID is correct for your region

### "Throttling" Errors

AWS Bedrock has default rate limits:

- Claude 3 Opus: Lower limits (contact AWS for increases)
- Claude 3.5 Sonnet: Medium limits
- Claude 3 Haiku: Higher limits

Request a quota increase through the AWS Service Quotas console if needed.

### "Model Not Found" Errors

- Verify the region supports the model you're requesting
- Check that you've enabled access to that specific model in the Bedrock console
- Ensure you're using the correct model ID format

## Benefits of Using Bedrock

1. **AWS Infrastructure** - Models run in AWS regions close to your infrastructure
2. **Unified Billing** - Combine with other AWS costs
3. **Compliance** - Some organizations require AWS for compliance reasons
4. **Lower Latency** - If your infrastructure is on AWS
5. **VPC Endpoints** - Private connectivity without internet access

## Current Limitations & Roadmap

### Current Status

1. **✅ Text Generation** - Full support for text conversations
2. **✅ Streaming** - Real-time response streaming
3. **✅ Conversation History** - Multi-turn conversations
4. **✅ System Prompts** - Custom system instructions
5. **✅ Tool Calling** - Full support for built-in tools
6. **✅ Vision/Images** - Base64-encoded image support
7. **✅ Multi-turn Tool Sequences** - Automatic tool execution loops
8. **✅ Tool Approval** - Requires approval for dangerous tools (Write, Bash, Edit)
9. **✅ MCP Integration** - Automatic discovery and execution of MCP tools (see [mcp-integration.md](./mcp-integration.md))
10. **❌ Computer Use** - Not yet supported

### ✅ Implemented Features

**Tool Calling** - Fully working as of v2!

- ✅ Define tool schemas compatible with Bedrock format
- ✅ Map built-in tools (Read, Write, Bash, Grep, Glob, WebFetch, WebSearch, NotebookEdit)
- ✅ Add tool array to Bedrock API requests
- ✅ Handle `stop_reason: "tool_use"` responses
- ✅ Parse tool_use content blocks
- ✅ Emit tool approval requests for dangerous tools (Write, Bash, Edit)
- ✅ Execute approved tools (Read, Grep, Glob, WebFetch, etc.)
- ✅ Execute Bash commands with sandbox restrictions
- ✅ Handle file write operations (Write, Edit)
- ✅ Capture tool execution results
- ✅ Format tool results as `tool_result` content blocks
- ✅ Send results back to Bedrock
- ✅ Continue conversation with tool results
- ✅ Handle multi-turn tool sequences (up to 10 iterations)
- ✅ Tool error handling and retry logic

**Vision/Images** - Fully working!

- ✅ Support base64-encoded images in messages
- ✅ Handle multi-modal content blocks
- ✅ Works with all Claude 3 vision models

### Roadmap - Future Enhancements

**Phase 1: MCP Integration** ✅ Complete

- [x] MCP (Model Context Protocol) tool integration
- [x] Dynamic tool discovery from MCP servers
- [x] MCP tool execution

**Phase 2: Advanced Features**

- [ ] Tool result caching
- [ ] Parallel tool execution
- [ ] Support image URLs (in addition to base64)
- [ ] Screenshot capture for computer use
- [ ] Image analysis tools
- [ ] OCR capabilities

### Model Availability

Not all Claude models may be available in all regions. Check the Bedrock console for region-specific availability.

### Feature Lag

Bedrock models may lag behind the direct Anthropic API by a few weeks for new features and model versions.

## Cost Optimization

1. **Use Haiku for Simple Tasks** - Much cheaper than Sonnet/Opus
2. **Batch Inference** - For non-interactive workloads, use Bedrock's batch API (50% discount)
3. **Monitor Usage** - Use AWS Cost Explorer to track Bedrock spending
4. **Set Budget Alerts** - Configure AWS Budgets to prevent surprise bills

## Next Steps

- See `bedrock-provider-v2.ts` for implementation details
- Check `cost-calculator.ts` for pricing calculations
- Review `stream.ts` for routing logic
- See [mcp-integration.md](./mcp-integration.md) for MCP server configuration
