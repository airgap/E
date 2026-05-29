/**
 * pluginPrompt.svelte.ts (LYK-1056) — promise-bridged modal prompts for
 * the plugin RPC methods ui.showQuickPick and ui.showInputBox.
 *
 * The bridge handler calls quickPick()/inputBox() and awaits the
 * returned promise; the user's choice (or dismissal → null) resolves it.
 * A single active request at a time — a new request supersedes any
 * pending one (the superseded promise resolves null, matching "dismiss").
 * PluginPromptModal renders whatever's active and calls resolve().
 */

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
}

interface QuickPickRequest {
  kind: 'quickPick';
  pluginId: string;
  items: QuickPickItem[];
  placeholder?: string;
  resolve: (picked: string | null) => void;
}

interface InputBoxRequest {
  kind: 'inputBox';
  pluginId: string;
  prompt?: string;
  value?: string;
  placeholder?: string;
  password?: boolean;
  resolve: (value: string | null) => void;
}

type ActiveRequest = QuickPickRequest | InputBoxRequest;

function createPluginPromptStore() {
  let active = $state<ActiveRequest | null>(null);

  /** Resolve the current request (if any) with the given outcome. */
  function settle(req: ActiveRequest, outcome: string | null) {
    // Only settle if it's still the active request — guards double-resolve.
    if (active === req) active = null;
    req.resolve(outcome as never);
  }

  return {
    get active() {
      return active;
    },

    quickPick(
      pluginId: string,
      items: QuickPickItem[],
      placeholder?: string,
    ): Promise<string | null> {
      // Supersede any pending prompt.
      if (active) active.resolve(null as never);
      return new Promise<string | null>((resolve) => {
        active = { kind: 'quickPick', pluginId, items, placeholder, resolve };
      });
    },

    inputBox(
      pluginId: string,
      opts: { prompt?: string; value?: string; placeholder?: string; password?: boolean },
    ): Promise<string | null> {
      if (active) active.resolve(null as never);
      return new Promise<string | null>((resolve) => {
        active = {
          kind: 'inputBox',
          pluginId,
          prompt: opts.prompt,
          value: opts.value,
          placeholder: opts.placeholder,
          password: opts.password,
          resolve,
        };
      });
    },

    /** Called by the modal when the user picks an item / submits / cancels. */
    resolveActive(outcome: string | null) {
      if (active) settle(active, outcome);
    },
  };
}

export const pluginPromptStore = createPluginPromptStore();
