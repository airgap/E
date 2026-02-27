# Self-Improving Skills / Auto-Rule Generation - Implementation Summary

## Overview

This feature enables agents to autonomously detect recurring patterns in their work and propose new skills or rules for automation. Inspired by OpenClaw's self-improving skills system, it allows E to learn from its own behavior and continuously improve its capabilities.

## ✅ Acceptance Criteria Status

1. **✅ Pattern Detection**: Agents detect recurring patterns across conversations (e.g., same refactoring pattern applied 3+ times)
2. **✅ Proposal Generation**: When a pattern is detected, the agent proposes a new rule or skill to automate it
3. **✅ Agent Notes Integration**: Proposals appear as agent notes with "skill-proposal" category for user review
4. **✅ Auto-Creation**: Approved proposals are automatically written to `.e/skills/` or `.e/rules/` as appropriate
5. **✅ Skills Registry Search**: Agents can search the skills registry when they encounter a capability gap and suggest installation
6. **✅ Learning Log**: A "learning log" in the workspace tracks what patterns the agent has identified
7. **✅ Configurable Sensitivity**: Users can configure the sensitivity of pattern detection (aggressive, moderate, conservative)
8. **✅ Documentation**: Self-generated skills include documentation and usage examples

## Implementation Details

### 1. Database Schema (✅ Already Exists)

Three new tables were added to support pattern learning:

- **`pattern_detections`**: Stores detected recurring patterns
- **`skill_proposals`**: Stores generated skill/rule proposals
- **`tool_usage_records`**: Tracks tool usage for pattern analysis
- **`learning_log`**: Tracks learning insights and actions taken

### 2. Shared Types (`packages/shared/src/pattern-learning.ts`)

New TypeScript interfaces and types:

- `PatternSensitivity`: 'aggressive' | 'moderate' | 'conservative'
- `PatternType`: Categorizes patterns (refactoring, workflow, tool-usage, etc.)
- `PatternDetection`: Detected pattern structure
- `PatternExample`: Example occurrence of a pattern
- `LearningLogEntry`: Learning log entry
- `SkillProposal`: Skill/rule proposal structure
- `PatternLearningSettings`: Configuration for pattern detection
- `ApproveProposalRequest`: Request to approve a proposal
- `ToolUsageRecord`: Tool usage tracking

Updated `AgentNoteCategory` to include `'skill-proposal'`

### 3. Pattern Detector Service (`packages/server/src/services/pattern-detector.ts`)

Core service for pattern detection and proposal generation:

**Key Functions:**

- `getPatternDetectionSettings()`: Retrieves workspace-specific settings
- `analyzeConversationForPatterns()`: Analyzes conversation for patterns
- `recordToolUsage()`: Records tool usage for pattern analysis
- Pattern detection algorithms for:
  - Bash command patterns
  - Refactoring patterns
  - Workflow patterns (multi-tool sequences)
- Auto-proposal generation from detected patterns

**Pattern Detection Logic:**

- Groups tool calls by type
- Normalizes inputs for matching (e.g., replacing paths with placeholders)
- Calculates confidence scores based on occurrence frequency
- Stores patterns in database with examples

### 4. Skill Tool (`packages/server/src/services/tool-schemas.ts` & `tool-executor.ts`)

New "Skill" tool available to agents:

**Actions:**

- `search`: Search skills registry for existing skills
- `propose`: Propose a new skill or rule
- `check-learning`: View the learning log

**Tool Executor Implementation:**

- Searches skills registry via API
- Creates agent notes for proposals
- Retrieves learning log entries
- Returns formatted results to the agent

### 5. Pattern Learning Routes (`packages/server/src/routes/`)

Two route files for managing pattern learning:

**`pattern-detection.ts`:**

- `POST /api/pattern-detection/analyze`: Analyze conversation for patterns
- `GET /api/pattern-detection/patterns`: Get detected patterns
- `POST /api/pattern-detection/propose`: Generate proposal from pattern

**`learning.ts`:**

- Manages patterns, proposals, and learning log
- Handles approval/rejection of proposals
- Provides access to learning history

### 6. Streaming Integration (`packages/server/src/routes/stream.ts`)

Pattern detection runs automatically after each conversation:

- **Background Analysis**: Runs 5 seconds after response completion (non-blocking)
- **Auto-Proposal Creation**: If settings allow, proposals are auto-generated
- **Agent Notes**: Proposals appear as agent notes with detailed information
- **System Prompt**: Agents are instructed about the self-learning capability

### 7. Tool Usage Recording (`packages/server/src/services/bedrock-provider-v2.ts`)

Integrated into Bedrock provider (template for other providers):

- Records every tool call with normalized inputs
- Stores workspace path and conversation ID
- Enables pattern detection across conversations

### 8. Default Configuration

Sensible defaults via `DEFAULT_PATTERN_LEARNING_SETTINGS`:

```typescript
{
  enabled: true,
  sensitivity: 'moderate',
  minimumOccurrences: 3,
  confidenceThreshold: 0.7,
  autoCreateProposals: true,
  enabledPatternTypes: [
    'refactoring',
    'workflow',
    'tool-usage',
    'problem-solving',
    'file-pattern',
    'command-sequence',
  ],
}
```

**Sensitivity Presets:**

- **Aggressive**: 2 occurrences, 50% confidence
- **Moderate**: 3 occurrences, 70% confidence
- **Conservative**: 5 occurrences, 85% confidence

## How It Works

### Agent Workflow

1. **Agent performs work**: Uses tools like Edit, Bash, Read, Write
2. **Tool usage recorded**: Each tool call is logged with normalized inputs
3. **Pattern detection runs**: After conversation completes, analysis runs in background
4. **Patterns detected**: System identifies recurring behaviors
5. **Proposals generated**: If pattern qualifies, a skill/rule proposal is created
6. **Agent note created**: Proposal appears in Agent Notes panel
7. **User review**: User can approve, modify, or reject the proposal
8. **Auto-creation**: Approved proposals become actual skills/rules

### Pattern Detection Examples

**Bash Command Pattern:**

```bash
# If agent runs similar commands 3+ times:
npm test
npm test -- --watch
npm test -- --coverage
# → Proposes "Auto-Command" skill for test running
```

**Refactoring Pattern:**

```typescript
// If agent applies similar edits 3+ times:
Edit: Extract function
Edit: Rename variable for clarity
Edit: Extract component
// → Proposes "Auto-Refactor" rule for code organization
```

**Workflow Pattern:**

```
// If agent follows similar multi-step process:
1. Read config file
2. Edit code based on config
3. Run tests
4. Commit changes
// → Proposes "Auto-Workflow" skill for config-driven changes
```

## Agent Capabilities

Agents can now:

1. **Search for skills**: Use `Skill` tool with `action: "search"` to find existing skills
2. **Propose new skills**: Use `Skill` tool with `action: "propose"` to suggest automation
3. **Check learning history**: Use `Skill` tool with `action: "check-learning"` to review patterns
4. **Self-awareness**: Know when they're repeating patterns and can proactively suggest skills

## User Experience

### Agent Notes Panel

Proposals appear as notifications with:

- Clear title (e.g., "💡 Skill Proposal: Auto-Refactor abc123")
- Rationale explaining why it's useful
- Full skill/rule content
- Pattern details (occurrences, confidence)
- Approve/reject actions

### Configuration

Users can adjust in workspace settings (future UI):

```json
{
  "patternLearning": {
    "enabled": true,
    "sensitivity": "moderate",
    "minimumOccurrences": 3,
    "confidenceThreshold": 0.7,
    "autoCreateProposals": true,
    "enabledPatternTypes": ["refactoring", "workflow", "command-sequence"]
  }
}
```

## Future Enhancements

Potential improvements for future iterations:

1. **UI for Learning Dashboard**: Visual interface to view patterns, proposals, and learning history
2. **Cross-Workspace Learning**: Share learned patterns across multiple workspaces
3. **Pattern Refinement**: Allow users to refine detected patterns before creating skills
4. **Skill Versioning**: Track evolution of auto-generated skills
5. **Pattern Confidence Visualization**: Show why patterns were detected with visual examples
6. **Integration with Skills Marketplace**: Share successful auto-generated skills
7. **LLM-Based Pattern Analysis**: Use LLM to detect semantic similarities beyond simple matching
8. **Negative Pattern Detection**: Learn what NOT to do (anti-patterns)

## Testing

To test the feature:

1. **Repeat a pattern**: Run similar bash commands or edits 3+ times in a conversation
2. **Check agent notes**: Look for "💡 Skill Proposal" notifications
3. **Use Skill tool**: Ask the agent to search for skills or check learning log
4. **Approve proposal**: Review and approve a proposal to see it create a skill
5. **Verify database**: Check `pattern_detections` and `skill_proposals` tables

Example test scenario:

```
User: "Run npm test"
Agent: [runs command]
User: "Run npm test again"
Agent: [runs command]
User: "Run npm test one more time"
Agent: [runs command, detects pattern, creates proposal]
Agent Note: "💡 Skill Proposal: Auto-Command..."
```

## Files Modified/Created

### Created:

- `packages/shared/src/pattern-learning.ts`
- `packages/server/src/services/pattern-detector.ts`

### Modified:

- `packages/shared/src/agent-notes.ts` (added 'skill-proposal' category)
- `packages/shared/src/index.ts` (exports pattern learning types)
- `packages/server/src/db/database.ts` (database tables already existed)
- `packages/server/src/services/tool-schemas.ts` (added Skill tool)
- `packages/server/src/services/tool-executor.ts` (added executeSkillTool)
- `packages/server/src/services/bedrock-provider-v2.ts` (added tool usage recording)
- `packages/server/src/routes/stream.ts` (already had pattern detection integration)
- `packages/server/src/routes/pattern-detection.ts` (routes already existed)
- `packages/server/src/routes/learning.ts` (routes already existed)

## Integration with Existing Features

- **Agent Notes**: Proposals use existing agent notes system
- **Skills Registry**: Skill tool searches existing registry
- **Workspace Settings**: Respects workspace-specific configuration
- **Rules System**: Auto-generated rules integrate with existing rules
- **Tool System**: Skill tool follows standard tool execution pattern

## Performance Considerations

- **Async Pattern Detection**: Runs in background, doesn't block responses
- **Debounced Analysis**: 5-second delay after completion to batch analysis
- **Database Indexing**: Proper indexes on pattern_detections and tool_usage_records
- **Normalized Storage**: Reduces duplicates through input normalization
- **Silent Failures**: Tool usage recording fails silently to not interrupt workflows

## Security & Privacy

- **No External Data**: All pattern detection happens locally
- **User Control**: Users can disable or configure sensitivity
- **Review Before Creation**: All proposals require user approval
- **Workspace-Scoped**: Patterns are isolated to workspace
- **No Automatic Execution**: Generated skills don't auto-execute

## Conclusion

The Self-Improving Skills / Auto-Rule Generation feature is now fully implemented and integrated into E. Agents can learn from their own behavior, detect patterns, and propose automation opportunities, creating a continuously improving development environment.

---

**Implementation Date**: 2026-02-25
**Status**: ✅ Complete
**Quality Check**: Ready for testing
