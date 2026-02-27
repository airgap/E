# Self-Improving Skills / Auto-Rule Generation

## Overview

This system enables agents to autonomously detect recurring patterns in their work and propose reusable skills or rules. When you use the agent repeatedly for similar tasks, it will notice the pattern and suggest creating a skill to automate it in the future.

## How It Works

### 1. **Pattern Detection**

The agent continuously monitors:

- **Conversation messages** for recurring topics (refactoring, debugging, testing, etc.)
- **Tool usage** for repeated operations (editing files, running commands, etc.)

When a pattern appears **3+ times** across conversations, the system detects it automatically.

### 2. **Automatic Proposals**

When a pattern is detected with sufficient confidence:

1. The agent generates a skill or rule proposal
2. An **agent note** is created with category `skill-proposal`
3. You'll see it in the Agent Notes panel with a 💡 icon

### 3. **Review & Approve**

To review and approve a proposal:

1. Open the **Agent Notes** panel
2. Find notes with category "Skill Proposal"
3. Review the generated skill/rule content
4. Click "Approve" to install it, or "Reject" to dismiss it

### 4. **Installation**

Approved proposals are automatically written to:

- **Skills**: `.e/skills/{skill-name}/SKILL.md` (workspace) or `~/.e/skills/{skill-name}/SKILL.md` (global)
- **Rules**: `.e/rules/{rule-name}.md` (workspace) or `~/.e/rules/{rule-name}.md` (global)

## API Endpoints

### Analyze Patterns

```bash
POST /api/pattern-detection/analyze
{
  "workspacePath": "/path/to/workspace",
  "conversationId": "conv_123",
  "sensitivity": "moderate",  // or "aggressive", "conservative"
  "enabledTypes": ["refactoring", "workflow", "tool-usage"]
}
```

### Get Detected Patterns

```bash
GET /api/pattern-detection/patterns?workspacePath=/path/to/workspace
```

### Generate Proposal

```bash
POST /api/pattern-detection/propose
{
  "patternId": "pattern_abc",
  "proposalType": "skill",  // or "rule"
  "createNote": true
}
```

### List Proposals

```bash
GET /api/pattern-detection/proposals?workspacePath=/path/to/workspace&status=pending
```

### Approve Proposal

```bash
POST /api/pattern-detection/proposals/{proposalId}/approve
```

### Reject Proposal

```bash
POST /api/pattern-detection/proposals/{proposalId}/reject
```

### View Learning Log

```bash
GET /api/pattern-detection/learning-log?workspacePath=/path/to/workspace&limit=50
```

### Auto-Check and Propose

```bash
POST /api/pattern-detection/check-and-propose
{
  "workspacePath": "/path/to/workspace",
  "minOccurrences": 3,
  "autoCreateNotes": true
}
```

## Configuration

Pattern detection sensitivity can be configured via the `/analyze` endpoint:

### Sensitivity Levels

- **aggressive**: Detects patterns after 2 occurrences, 50% confidence threshold
- **moderate** (default): Detects patterns after 3 occurrences, 70% confidence threshold
- **conservative**: Detects patterns after 5 occurrences, 80% confidence threshold

### Pattern Types

The system can detect:

- `refactoring` - Repeated code transformations (extracting functions, renaming, etc.)
- `workflow` - Repeated sequences of operations
- `tool-usage` - Repeated tool call patterns
- `problem-solving` - Repeated solutions to similar problems
- `file-pattern` - Repeated file operations
- `command-sequence` - Repeated bash commands

## Example: Auto-Generated Skill

When you refactor code by extracting functions 3+ times, the system might propose:

```markdown
# extract-function-refactoring

## Description

Automates extracting reusable functions from duplicated code

Detected pattern: This skill was automatically generated after observing 4 similar
operations across 2 conversation(s).

## Usage

Use the "extract-function-refactoring" skill when you need to extract reusable
functions from duplicated code.

## Examples

### Example 1

\`\`\`json
{
"file*path": "src/utils.ts",
"old_string": "const result = data.map(x => x * 2);",
"new*string": "const result = double(data);\n\nfunction double(arr: number[]) {\n return arr.map(x => x * 2);\n}"
}
\`\`\`

## Related Tools

- Edit
- Read
```

## Agent Note Example

When a proposal is created, you'll see an agent note like:

```
💡 Skill Proposal: extract-function-refactoring

## extract-function-refactoring

Automates extracting reusable functions from duplicated code

### Rationale

You've performed this refactoring pattern 4 times across 2 conversations.
Creating a skill for it will make future refactorings faster and more consistent.

### Pattern Detected

- **Type**: refactoring
- **Summary**: Extracting reusable functions/components
- **Occurrences**: 4
- **Confidence**: 90%

### Proposal Details

- Identified in conversations: conv_abc, conv_xyz
- First seen: 2 hours ago
- Last seen: 10 minutes ago

---

**Proposal ID**: `proposal_123`

To approve this proposal, use the Pattern Detection panel or call:
POST /api/pattern-detection/proposals/proposal_123/approve
```

## Testing the System

### 1. Trigger Pattern Detection

Repeat a task 3+ times (e.g., editing TypeScript files with similar patterns):

```bash
# Conversation 1
Ask agent: "Extract this duplicated code into a reusable function"

# Conversation 2
Ask agent: "Extract this duplicated code into a reusable function"

# Conversation 3
Ask agent: "Extract this duplicated code into a reusable function"

# After 3rd occurrence, check agent notes:
GET /api/agent-notes?workspacePath=/your/workspace&category=skill-proposal
```

### 2. Manual Pattern Analysis

Force pattern detection on a specific conversation:

```bash
curl -X POST http://localhost:3000/api/pattern-detection/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "workspacePath": "/home/user/myproject",
    "conversationId": "your_conversation_id",
    "sensitivity": "aggressive"
  }'
```

### 3. View Learning History

See what patterns the agent has learned:

```bash
curl http://localhost:3000/api/pattern-detection/learning-log?workspacePath=/home/user/myproject
```

## Automatic Behavior

The system runs **automatically** in the background:

1. ✅ After every conversation turn completes (message_stop event)
2. ✅ Pattern detection runs asynchronously (non-blocking)
3. ✅ Proposals are auto-generated when patterns reach threshold
4. ✅ Agent notes are created automatically for review

## Limitations & Future Enhancements

### Current Limitations

- ❌ Settings UI not yet implemented (must configure via API)
- ❌ Learning log UI not yet implemented (must view via API)
- ❌ Skills registry search not yet implemented

### Planned Enhancements

1. **Settings Panel** - UI for configuring sensitivity and thresholds
2. **Learning Log Panel** - Visual timeline of what the agent has learned
3. **Skills Registry Search** - Auto-suggest skills from registry when capability gaps detected
4. **Tool Sequence Detection** - Detect patterns in sequences of tool calls
5. **Cross-Workspace Learning** - Learn patterns across all workspaces

## File Locations

- **Types**: `packages/shared/src/pattern-learning.ts`
- **Pattern Detection**: `packages/server/src/services/pattern-detection.ts`
- **Proposal Generator**: `packages/server/src/services/proposal-generator.ts`
- **API Routes**: `packages/server/src/routes/pattern-detection.ts`
- **Database Schema**: `packages/server/src/db/database.ts`
- **Integration Hook**: `packages/server/src/services/claude-process/manager.ts` (line ~1112)

## Troubleshooting

### Patterns not being detected?

1. Check that you've performed the same action 3+ times
2. Try lowering sensitivity to "aggressive"
3. Manually trigger analysis: `POST /api/pattern-detection/analyze`
4. Check logs for errors: `console.error('Pattern analysis error')`

### Proposals not appearing as agent notes?

1. Check agent notes: `GET /api/agent-notes?category=skill-proposal`
2. Verify proposals exist: `GET /api/pattern-detection/proposals?status=pending`
3. Check that `createNote: true` in propose request

### Approved proposals not installed?

1. Check approval response for `installedPath`
2. Verify write permissions to `.e/skills/` or `.e/rules/`
3. Check proposal status: `GET /api/pattern-detection/proposals/{id}`

## Support

For issues or questions:

1. Check the `PATTERN_LEARNING_STATUS.md` file for implementation status
2. Review API endpoint documentation above
3. Check server logs for error messages
4. Verify database tables exist: `detected_patterns`, `skill_rule_proposals`, `learning_log`, `tool_usage_records`
