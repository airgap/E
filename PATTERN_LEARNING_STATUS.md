# Pattern Learning / Self-Improving Skills - Implementation Status

## Overview

The self-improving skills and auto-rule generation system enables agents to detect recurring patterns in their work and autonomously propose reusable skills or rules.

## Implementation Status

### ✅ Completed Features

#### 1. Database Schema

- **`detected_patterns`** table - Stores identified patterns from conversation analysis
- **`skill_rule_proposals`** table - Stores generated skill/rule proposals
- **`learning_log`** table - Tracks learning events and insights
- **`tool_usage_records`** table - Records tool usage for pattern analysis
- Location: `packages/server/src/db/database.ts` (lines 379-448, 558-572)

#### 2. Pattern Detection Service

- **Message-based pattern detection** - Analyzes conversation messages for recurring patterns
- Pattern types supported: refactoring, debugging, testing, documentation, workflow, code-generation
- Confidence scoring based on occurrences, time span, and conversation diversity
- Location: `packages/server/src/services/pattern-detection.ts`

#### 3. Proposal Generation Service

- **Skill proposal generator** - Creates SKILL.md files with frontmatter
- **Rule proposal generator** - Creates rule markdown files
- Content includes: description, rationale, examples, usage instructions
- Location: `packages/server/src/services/proposal-generator.ts`

#### 4. API Routes

- `POST /api/pattern-detection/analyze` - Manually trigger pattern analysis
- `GET /api/pattern-detection/patterns` - Get detected patterns for a workspace
- `POST /api/pattern-detection/propose` - Generate a skill/rule proposal
- `GET /api/pattern-detection/proposals` - List proposals
- `POST /api/pattern-detection/proposals/:id/approve` - Approve and install
- `POST /api/pattern-detection/proposals/:id/reject` - Reject a proposal
- `POST /api/pattern-detection/learning-log` - Add learning log entry
- `GET /api/pattern-detection/learning-log` - Get learning logs
- `POST /api/pattern-detection/check-and-propose` - Auto-check and propose
- Location: `packages/server/src/routes/pattern-detection.ts`

#### 5. Agent Note Integration

- Proposals automatically create agent notes with category `'skill-proposal'`
- Agent notes link back to proposal ID via metadata
- Users can review proposals in the Agent Notes panel
- Location: `packages/server/src/routes/pattern-detection.ts` (lines 120-174)

#### 6. System Prompt Integration

- Base system prompt includes self-improving skills instructions
- Agents are told to propose skills when they notice patterns (3+ occurrences)
- Location: `packages/server/src/routes/stream.ts` (lines 27-34)

#### 7. Shared Types

- `PatternSensitivity` - sensitivity levels (aggressive, moderate, conservative)
- `PatternType` - pattern categories
- `PatternDetection` - detected pattern structure
- `LearningLogEntry` - learning log entries
- `SkillProposal` - skill/rule proposal metadata
- `PatternLearningSettings` - configuration options
- Location: `packages/shared/src/pattern-learning.ts`

### ⚠️ Partially Implemented

#### 1. Tool Usage Tracking

- ✅ Table exists (`tool_usage_records`)
- ❌ Not actively recording tool calls yet
- ❌ Not integrated into pattern detection analysis
- **Required**: Hook into stream events to record tool_use blocks

#### 2. Automatic Pattern Detection

- ✅ Manual trigger endpoint exists (`/api/pattern-detection/analyze`)
- ✅ Check-and-propose endpoint exists (`/api/pattern-detection/check-and-propose`)
- ❌ Not automatically triggered after conversations
- **Required**: Add post-message hook to trigger analysis

### ❌ Missing Features

#### 1. Skills Registry Search (AC #5)

- "Agents can search the skills registry when they encounter a capability gap and suggest installation"
- **Required**:
  - Detect when agents mention missing capabilities
  - Search skills registry for matching skills
  - Suggest relevant skills via agent notes

#### 2. Pattern Learning Settings UI (AC #7)

- Settings structure exists in types
- **Required**: Add UI in Settings panel for configuring:
  - Enable/disable pattern learning
  - Sensitivity level (aggressive, moderate, conservative)
  - Minimum occurrences threshold
  - Auto-create proposals toggle

#### 3. Learning Log UI (AC #6)

- Learning log API exists
- **Required**: Add UI panel to view learning history

## Acceptance Criteria Status

1. ✅ **Agents detect recurring patterns across conversations**
   - ✓ Message-based pattern detection implemented
   - ⚠️ Tool usage pattern detection partially implemented (table exists, not hooked up)

2. ✅ **When a pattern is detected, the agent proposes a new rule or skill to automate it**
   - ✓ Proposal generation service implemented
   - ✓ Check-and-propose endpoint exists
   - ⚠️ Not automatically triggered (requires integration)

3. ✅ **Proposals appear as agent notes with "skill-proposal" category for user review**
   - ✓ Fully implemented (lines 120-174 in pattern-detection.ts)

4. ✅ **Approved proposals are automatically written to .e/skills/ or .e/rules/ as appropriate**
   - ✓ Implemented in `approveProposal()` function
   - ✓ Creates SKILL.md files in .e/skills/ or ~/.e/skills/
   - ✓ Creates rule .md files in .e/rules/ or ~/.e/rules/

5. ❌ **Agents can search the skills registry when they encounter a capability gap and suggest installation**
   - Not implemented

6. ⚠️ **A "learning log" in the workspace tracks what patterns the agent has identified**
   - ✓ Backend API exists
   - ❌ UI not implemented

7. ⚠️ **Users can configure the sensitivity of pattern detection**
   - ✓ Types and defaults defined
   - ❌ Settings UI not implemented
   - ⚠️ Can be configured via analyze endpoint parameters

8. ✅ **Self-generated skills include documentation and usage examples**
   - ✓ Proposal generator includes description, rationale, examples
   - ✓ SKILL.md includes frontmatter with metadata

## Next Steps to Complete

### High Priority

1. **Integrate pattern detection into stream handler**

   ```typescript
   // In packages/server/src/routes/stream.ts
   // After message_stop event:
   import { detectPatterns, shouldProposeSkillOrRule } from '../services/pattern-detection';
   import { generateProposal } from '../services/proposal-generator';

   // Trigger pattern analysis asynchronously
   detectPatterns(workspacePath, conversationId, 'moderate').then((patterns) => {
     for (const pattern of patterns) {
       if (shouldProposeSkillOrRule(pattern, 3)) {
         generateProposal(pattern, 'skill').then((proposal) => {
           // Creates agent note automatically
         });
       }
     }
   });
   ```

2. **Add tool usage recording**

   ```typescript
   // In stream handler, when processing tool_use events:
   import { recordToolUsage } from '../services/pattern-detector';

   // On tool_use completion:
   recordToolUsage(conversationId, workspacePath, toolName, toolInput);
   ```

3. **Implement skills registry search**
   ```typescript
   // Add to packages/server/src/services/skills-registry/discovery.ts
   export async function suggestSkillsForCapability(
     query: string,
     workspacePath: string,
   ): Promise<SkillSuggestion[]> {
     // Search registry for matching skills
     // Return suggestions with confidence scores
   }
   ```

### Medium Priority

4. **Add Pattern Learning settings to Settings UI**
   - Add section in Settings modal
   - Fields: enabled, sensitivity, minOccurrences, autoCreateProposals

5. **Add Learning Log UI panel**
   - New panel showing chronological learning history
   - Filter by event type, date range
   - Link to related patterns and proposals

### Low Priority

6. **Enhance tool usage pattern detection**
   - Add semantic analysis of tool sequences
   - Detect repeated tool combinations
   - Generate more specific skill proposals based on tool patterns

## Testing

To test the current implementation:

```bash
# 1. Analyze a conversation for patterns
curl -X POST http://localhost:3000/api/pattern-detection/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "workspacePath": "/home/user/myproject",
    "conversationId": "conv_123",
    "sensitivity": "moderate"
  }'

# 2. Get detected patterns
curl http://localhost:3000/api/pattern-detection/patterns?workspacePath=/home/user/myproject

# 3. Generate a proposal from a pattern
curl -X POST http://localhost:3000/api/pattern-detection/propose \
  -H "Content-Type: application/json" \
  -d '{
    "patternId": "pattern_abc",
    "proposalType": "skill",
    "createNote": true
  }'

# 4. Get proposals
curl http://localhost:3000/api/pattern-detection/proposals?workspacePath=/home/user/myproject&status=pending

# 5. Approve a proposal
curl -X POST http://localhost:3000/api/pattern-detection/proposals/proposal_xyz/approve

# 6. View learning log
curl http://localhost:3000/api/pattern-detection/learning-log?workspacePath=/home/user/myproject
```

## Files Modified/Created

### Created

- ✅ `packages/shared/src/pattern-learning.ts` - Types and interfaces
- ✅ `packages/server/src/services/pattern-detection.ts` - Pattern detection logic
- ✅ `packages/server/src/services/proposal-generator.ts` - Proposal generation
- ✅ `packages/server/src/routes/pattern-detection.ts` - API routes
- ⚠️ Database tables added to `packages/server/src/db/database.ts`

### Modified

- ✅ `packages/shared/src/agent-notes.ts` - Added 'skill-proposal' category
- ✅ `packages/shared/src/index.ts` - Exported pattern learning types
- ✅ `packages/server/src/index.ts` - Registered pattern-detection routes
- ✅ `packages/server/src/routes/stream.ts` - Added self-improving skills system prompt

## Summary

The self-improving skills system is **~75% complete**:

- ✅ Core infrastructure fully implemented
- ✅ Pattern detection from messages working
- ✅ Proposal generation and approval working
- ✅ Agent note integration working
- ⚠️ Automatic triggering needs integration
- ⚠️ Tool usage tracking needs hooking up
- ❌ Skills registry search not implemented
- ❌ Settings UI not implemented
- ❌ Learning log UI not implemented

The system is **functional** and can be used manually via API endpoints. With the integration hooks added (steps 1-3 above), it will meet all critical acceptance criteria.
