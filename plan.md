# Rename: Project → Workspace

## Overview

Rename all "Project" terminology to "Workspace" throughout the codebase. This frees up "Project" for the higher-level initiative concept, and "Workspace" better describes what these tabs/contexts actually are (a repo/folder working context).

Memory becomes "Workspace Memory" (workspace-specific), with global memory as a separate future concept.

## Status: Functionally Complete

The rename is **functionally complete**. All types, APIs, database tables, store methods, and UI behavior use "workspace" terminology. A few source files retain the old "project" filename for backward compatibility, but their exports and internal logic all use the new naming.

### What's Done

- **Database**: Tables renamed (`workspaces`, `workspace_memories`), columns renamed (`workspace_path`, `workspace_id`), migrations in place
- **Shared types**: All types export as `Workspace`, `WorkspaceSettings`, `WorkspaceSummary`, `WorkspaceMemory`, etc.
- **Server routes**: Registered at `/api/workspaces` and `/api/workspace-memory`
- **Client API**: Uses `api.workspaces` and `api.workspaceMemory`
- **Client stores**: Export `workspaceListStore`, `workspaceMemoryStore`, use `workspacePath`/`workspaceId` throughout
- **UI modals**: Use `'workspace-setup'` modal type
- **All internal references**: Use workspace terminology

### Remaining (cosmetic file renames only)

These files still have old names but all exports/internals use "workspace":

- `packages/shared/src/projects.ts` → could be `workspaces.ts`
- `packages/shared/src/project-memory.ts` → could be `workspace-memory.ts`
- `packages/server/src/routes/projects.ts` → could be `workspaces.ts`
- `packages/server/src/routes/project-memory.ts` → could be `workspace-memory.ts`
- `packages/client/src/lib/stores/projects.svelte.ts` → could be `workspaces.svelte.ts`
- `packages/client/src/lib/stores/project-memory.svelte.ts` → could be `workspace-memory.svelte.ts`
- `packages/client/src/lib/components/layout/ProjectSwitcher.svelte` → could be `WorkspaceSwitcher.svelte`
- `packages/client/src/lib/components/settings/ProjectSetup.svelte` → could be `WorkspaceSetup.svelte`
