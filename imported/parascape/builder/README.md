# Parascape Builder

A freeform site builder for Parascape components. Drop components onto a
canvas, drag to position, resize from the corner, and edit props in the
inspector. Everything you place is a real Parascape `.pui` component compiled
and rendered live via the demos' live-compiler.

```sh
bun run dev      # then open http://localhost:5273/builder/
```

## Custom components

Click **+ New** under _Custom_ to author a reusable component as `.pui`
source. It compiles live (with an inline `✓ compiles` / error readout),
shows up in the palette, and every instance on the canvas re-renders as you
edit it. The project autosaves to `localStorage`; **Export** emits real
`.pui` — one `Page.pui` for the layout plus one file per custom component.

## Generate with AI (optional)

The **✨ Generate with AI** box turns a natural-language prompt into a custom
component. It POSTs to a small ParaBun server that runs a local GGUF model
through `parabun:llm`, feeds it the component catalog as context, and returns
`.pui` source — which lands in the same custom-component path (editable,
placeable, exportable).

Run the server with **ParaBun** (it needs the `parabun:llm` builtin — not
node/bun):

```sh
bun run builder:ai            # = parabun builder/llm-server.ts
# or pick a model / port:
PARASCAPE_MODEL=/path/to/model.gguf PORT=8787 parabun builder/llm-server.ts
```

The builder calls `http://localhost:8787` by default. If the server isn't
running, the box shows a friendly hint and the rest of the builder is
unaffected.

> Latency is dominated by the model and your hardware. With LLM CUDA working,
> a 1B model returns a component in a few seconds; on a CPU fallback expect
> ~1 minute. A small instruct model (Llama-3.2-1B, Qwen2.5-0.5B) is plenty
> for single components.
