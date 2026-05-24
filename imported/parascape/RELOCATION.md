# Parascape platform → E (relocated 2026-05-24)

This is a **source snapshot** of the Parascape platform, preserved here before
Parascape is reduced to a component-library + showcase (its platform was scope
creep; E is the IDE/platform). Build artifacts, the 92 MB tauri binary, tests,
and node_modules were stripped — this is source only (~5 MB). The full original
also lives in git at `airgap/parascape`.

**This is staging for integration, not a package to build as-is.** Port pieces
into E's structure (`packages/client`, `packages/server`) under the E Linear
project tickets; prune this dir once absorbed.

## What's here → where it goes (E Linear project "E", key LYK)

- `designer/` — the visual builder (`Designer.pui` = Section-tree model, canvas,
  palette, inspector, `nodeBody`/`pageToSource`; `component-meta.ts`, `sections.ts`,
  `react-export.ts`). → **LYK-970** (designer as an E mode). Use E's CM6 for code;
  drop the textarea Code Mode.
- `designer/lsp/pui-lsp.ts` — renderer-agnostic `.pui` analysis engine (severity
  diagnostics + reactive-dependents + hover, on `@lyku/para-preprocess`). The
  `lsp-worker.ts`/`lsp-client.ts`/squiggle rendering are textarea-specific — drop
  them; wrap the engine as a **CM6 extension**. → **LYK-968**.
- `scripts/gen-sibits-manifest.ts` + `components/si-bits/` — si-bits manifest
  (303 components, TS-AST prop extraction) + the generator. → **LYK-969**
  (ComponentLibrary consumer; or move the generator into Lyku/si-bits as codegen
  the library ships). `components/catalog.ts` + `components/manifests.json` are the
  Cloudscape (Parascape) library's manifest — the other pluggable library.
- `demos/live-compile.ts` — runtime `.pui`/Svelte compile for canvas preview. → LYK-970.
- `server/` — the Worker/D1/DO backend (lockstep handlers, `ProjectRoom` collab
  Durable Object, account/sharing/comments). → **LYK-971** (E Cloud) _if_ publish/
  collab earn their place in E; otherwise reference only.
- `builder/`, `preview/` — the freeform builder + published-site router. Reference.

## Dropped on purpose (Parascape-platform scope creep — don't carry into E by default)

Data connectors, no-code actions, React-export-as-a-product, in-browser collab UI,
the publish-to-Cloudflare flow. Bring any into E only as a deliberate decision.

## Honest caveats

- si-bits components are **not self-contained** (sass modules, `@lyku/monolith-ts-api`,
  assets) — live canvas preview needs E's real build context (the reason this moved here).
- Lyku's own components/pages are mostly `.svelte` with runes — accept as-authored.
- Editing real Lyku pages visually (LYK-972) needs source-canonical AST-patch
  editing, not the doc→source generation this designer does today.
