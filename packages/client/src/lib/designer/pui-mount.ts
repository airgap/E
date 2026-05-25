// In-browser eval + mount harness for compiled `.pui` components (LYK-970).
//
// `compilePui` gives us Svelte-5 client JS — an ES module that imports
// `svelte/internal/client` (and a disclose-version marker) and `export default`s
// the component. To render it live we evaluate that module string and feed the
// resolved component to Svelte's `mount`.
//
// Key correctness point: the evaluated component MUST use the SAME
// `svelte/internal/client` instance as E's own bundle, or `mount` won't drive
// it. We import E's instances statically and resolve the module's bare imports
// against them. Anything else (the .pui importing other components/libs) is not
// resolvable yet — surfaced as a clear error rather than a crash; recursive
// component resolution is a later slice.
import { mount, unmount } from 'svelte';
// svelte/internal/client ships no .d.ts (it's the runtime the compiler targets);
// resolves fine at build/runtime. We only need the namespace object to hand to
// the evaluated component, so the `any` is intentional.
// @ts-expect-error - no declaration file for svelte internal
import * as SvelteInternalClient from 'svelte/internal/client';

type AnyModule = Record<string, unknown> & { default?: unknown };

const RESOLVED: Record<string, AnyModule> = {
  'svelte/internal/client': SvelteInternalClient as AnyModule,
  'svelte/internal/disclose-version': {},
  svelte: { mount, unmount } as AnyModule,
};

class UnresolvedImportError extends Error {
  constructor(public specifier: string) {
    super(
      `Can't render: unresolved import "${specifier}" (component/library imports aren't supported in the preview yet)`,
    );
    this.name = 'UnresolvedImportError';
  }
}

/** Rewrite the compiled ES module into a `new Function` body that returns the default export. */
function rewriteModule(code: string): string {
  let body = code;
  // Side-effect imports (e.g. disclose-version) — drop.
  body = body.replace(/^[ \t]*import\s+['"][^'"]+['"];?[ \t]*$/gm, '');
  // import * as N from 'x';
  body = body.replace(
    /^[ \t]*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (_m, n, src) => `const ${n} = __req(${JSON.stringify(src)});`,
  );
  // import { a, b as c } from 'x';
  body = body.replace(
    /^[ \t]*import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (_m, names, src) =>
      `const {${names.replace(/\s+as\s+/g, ': ')}} = __req(${JSON.stringify(src)});`,
  );
  // import N from 'x';
  body = body.replace(
    /^[ \t]*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (_m, n, src) => `const ${n} = __dflt(__req(${JSON.stringify(src)}));`,
  );
  // export default X;  →  capture the component
  body = body.replace(/^[ \t]*export\s+default\s+/m, 'var __default = ');
  // export const/let/var/function/class  →  drop the `export`
  body = body.replace(/^[ \t]*export\s+(?=(?:const|let|var|function|class)\b)/gm, '');
  // export { ... };  →  drop
  body = body.replace(/^[ \t]*export\s+\{[^}]*\};?[ \t]*$/gm, '');
  return `${body}\nreturn typeof __default !== "undefined" ? __default : undefined;`;
}

function evalComponent(js: string): unknown {
  const req = (src: string): AnyModule => {
    const m = RESOLVED[src];
    if (!m) throw new UnresolvedImportError(src);
    return m;
  };
  const dflt = (m: AnyModule) => (m && 'default' in m ? m.default : m);
  // eslint-disable-next-line no-new-func
  const factory = new Function('__req', '__dflt', rewriteModule(js));
  return factory(req, dflt);
}

export interface PuiMountHandle {
  destroy(): void;
}

/**
 * Evaluate compiled `.pui` JS, inject its CSS, and mount the component into
 * `target`. Returns a handle to unmount. Throws on unresolved imports / eval
 * errors (caller shows the message).
 */
export function mountPui(target: HTMLElement, js: string, css?: string): PuiMountHandle {
  const Component = evalComponent(js);
  if (typeof Component !== 'function') {
    throw new Error('Compiled .pui has no default-exported component');
  }

  let styleEl: HTMLStyleElement | undefined;
  if (css) {
    styleEl = document.createElement('style');
    styleEl.textContent = css;
    target.appendChild(styleEl);
  }

  const instance = mount(Component as Parameters<typeof mount>[0], { target });

  return {
    destroy() {
      try {
        unmount(instance);
      } catch {
        // already torn down
      }
      styleEl?.remove();
    },
  };
}
